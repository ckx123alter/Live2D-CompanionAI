"""Bounded PCM streaming shared by local FastAPI and Cloudflare adapters."""
import asyncio
import base64
import hashlib
import inspect
import json
import struct
from .providers import DoubaoSpeech, ProviderError
from .speech_text import doubao_ssml


def speech_key(identity, text, message_id=None, *, pcm=False):
    payload = {**identity, 'text': text}
    if pcm:
        payload['format'] = 'wav-pcm16'
    if identity['provider'] == 'doubao' and (ssml := doubao_ssml(text)):
        payload['ssml'] = ssml
    if message_id is not None:
        payload['message_id'] = message_id
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def audio_type(audio):
    return 'audio/wav' if audio[:4] == b'RIFF' else 'audio/mpeg'


async def resolved(value):
    return await value if inspect.isawaitable(value) else value


def wave_file(pcm):
    if not pcm or len(pcm) % 2:
        raise ProviderError('语音数据不完整，请稍后重试。')
    return struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF',len(pcm)+36,b'WAVE',b'fmt ',16,1,1,24000,48000,2,16,b'data',len(pcm)) + pcm


async def speech_events(cache, text, message_id, *, prepare, shared_only, phrases, lease, wait_timeout=8):
    if text in phrases:
        message_id = None
    elif shared_only:
        yield {'type':'empty'}
        return
    legacy_key = speech_key(cache.identity, text, message_id)
    key = speech_key(cache.identity, text, message_id, pcm=True)
    async def lookup():
        for candidate in ([legacy_key,key] if message_id is None else [key,legacy_key]):
            if (audio := await resolved(cache.store.cached_speech(candidate))) is not None:
                return audio
        return None
    if (audio := await lookup()) is not None:
        yield {'type':'audio','mime':audio_type(audio),'data':base64.b64encode(audio).decode()}
        yield {'type':'done','cached':True}
        return
    if shared_only:
        yield {'type':'empty'}
        return
    async with lease(cache.store, 'audio:'+legacy_key, timeout=cache.settings.request_timeout,
                     limit=cache.settings.max_concurrent_requests, wait_timeout=wait_timeout):
        if (audio := await lookup()) is not None:
            yield {'type':'audio','mime':audio_type(audio),'data':base64.b64encode(audio).decode()}
            yield {'type':'done','cached':True}
            return
        provider, operation = await resolved(prepare(key))
        pcm = bytearray()
        try:
            async with asyncio.timeout(cache.settings.request_timeout):
                if not isinstance(provider, DoubaoSpeech):
                    raise ProviderError('当前语音服务不支持流式播放。')
                yield {'type':'start','format':'pcm_s16le','sample_rate':24000}
                async for chunk in provider.stream(text, format='pcm'):
                    pcm.extend(chunk)
                    if len(pcm) > provider.max_audio_bytes:
                        raise ProviderError('语音文件过大，请缩短回复。')
                    yield {'type':'chunk','data':base64.b64encode(chunk).decode()}
                audio = wave_file(bytes(pcm))
        except TimeoutError:
            raise ProviderError('语音合成超时，结果未能确认，请稍后再试。') from None
        except ProviderError as error:
            if operation and error.retry_safe:
                await resolved(cache.store.operation_status(operation, 'failed'))
            raise
        # Commit only complete speech; cancellation never caches a partial stream.
        await resolved(cache.store.cache_speech(key, audio, message_id))
        if operation:
            await resolved(cache.store.operation_status(operation, 'completed'))
        yield {'type':'done','cached':False}
