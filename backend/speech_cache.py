import asyncio
import hashlib
import json

from .coordination import GuardError, lease
from .config import Settings
from .providers import DoubaoSpeech, ProviderError, SpeechProvider
from .speech_text import doubao_ssml
from .store import Store
from .quick_replies import QUICK_REPLIES
from .drawing_game import BINGO_TEXT, DAILY_LIMIT_TEXT, WRONG_ANSWER_TEXT, RESUME_GAME_TEXT

FIXED_REPLY = "唔......触及到我的知识盲区了。"
WELCOME_TEXT = "你来啦。今天想和我聊点什么？"
CACHED_PHRASES = (FIXED_REPLY, WELCOME_TEXT, BINGO_TEXT, DAILY_LIMIT_TEXT, WRONG_ANSWER_TEXT, RESUME_GAME_TEXT, *(reply.text for reply in QUICK_REPLIES.values()))


class CachedSpeech:
    """Persist public phrases globally and other audio with its saved message."""

    def __init__(self, settings: Settings, provider: SpeechProvider, store: Store):
        self.settings = settings
        self.provider = provider
        self.store = store
        self.inflight: dict[str, asyncio.Task[bytes]] = {}
        self.max_inflight = settings.max_concurrent_requests
        identity = {"version": 1, "provider": settings.tts_provider, "format": "mp3"}
        if settings.tts_provider == "doubao":
            identity.update(endpoint=DoubaoSpeech.endpoint, voice=settings.doubao_tts_voice,
                            resource=settings.doubao_tts_resource_id, rate=settings.doubao_tts_speech_rate,
                            sample_rate=24000)
        else:
            identity.update(endpoint=settings.tts_base_url.rstrip("/"), model=settings.tts_model, voice=settings.tts_voice)
        # Keys are intentionally excluded: rotating credentials does not change audio.
        self.identity = identity

    async def synthesize(self, text: str, message_id: int | None = None, *, prepare=None, shared_only=False) -> bytes | None:
        if text in CACHED_PHRASES:
            message_id = None
        elif shared_only:
            return None
        elif message_id is None:
            return await self.provider.synthesize(text)
        identity = {**self.identity, "text": text}
        if self.identity["provider"] == "doubao" and (ssml := doubao_ssml(text)):
            # Reuse audio only when it was generated with the same pause rules.
            identity["ssml"] = ssml
        if message_id is not None:
            identity["message_id"] = message_id
        # Preserve the original fixed-phrase keys, including already generated audio.
        cache_key = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        cached = self.store.cached_speech(cache_key)
        if cached is not None or shared_only:
            return cached
        # Each caller waits on a database lease. Different workers re-check the
        # cache after acquiring it, so only the winner submits a paid request.
        if len(self.inflight) >= self.max_inflight:
            raise GuardError("语音合成繁忙，请稍后重试。")
        task = asyncio.create_task(self._generate(cache_key, text, message_id, prepare))
        task_id = str(id(task))
        self.inflight[task_id] = task
        task.add_done_callback(lambda done: self._finished(task_id, done))
        return await asyncio.shield(task)

    async def _generate(self, cache_key, text, message_id, prepare):
        async with lease(self.store, "audio:" + cache_key, timeout=self.settings.request_timeout, limit=self.max_inflight):
            cached = self.store.cached_speech(cache_key)
            if cached is not None:
                return cached
            provider, operation = prepare(cache_key) if prepare else (self.provider, None)
            try:
                async with asyncio.timeout(self.settings.request_timeout):
                    audio = await provider.synthesize(text)
            except TimeoutError:
                raise ProviderError("语音合成超时，结果未能确认，请稍后再试。") from None
            self.store.cache_speech(cache_key, audio, message_id)
            if operation:
                self.store.operation_status(operation, "completed")
            return audio

    def _finished(self, cache_key: str, task: asyncio.Task):
        self.inflight.pop(cache_key, None)
        if not task.cancelled():
            task.exception()  # Retrieve failures even when all playback requests stopped.

    async def close(self):
        if self.inflight:
            await asyncio.gather(*list(self.inflight.values()), return_exceptions=True)
