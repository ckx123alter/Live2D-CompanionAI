import base64
import json
import unittest
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx

from backend.config import Settings
from backend.providers import DoubaoSpeech, ProviderError
from backend.speech_stream import speech_events


class CompletionStream(httpx.AsyncByteStream):
    def __init__(self):
        self.closed = False

    async def __aiter__(self):
        packet = json.dumps({'code': 0, 'data': base64.b64encode(b'ID3-audio').decode()}).encode() + b'\n'
        yield packet[:9]
        yield packet[9:]
        yield b'{"code":20000000}\n'
        raise AssertionError('Must not read past the provider completion marker')

    async def aclose(self):
        self.closed = True


class SpeechStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_pcm_is_forwarded_before_completion_and_partial_audio_is_not_cached(self):
        release = asyncio.Event()
        class Chunks(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield json.dumps({'code':0,'data':base64.b64encode(b'\0\0'*4800).decode()}).encode()+b'\n'
                await release.wait()
                yield b'{"code":20000000}\n'
        saved, statuses = {}, []
        @asynccontextmanager
        async def lease(*args, **kwargs):
            yield
        store=SimpleNamespace(cached_speech=lambda key:saved.get(key),
            cache_speech=lambda key,audio,message:saved.update({key:audio}),
            operation_status=lambda *args:statuses.append(args))
        settings=Settings(_env_file=None,app_env='local',tts_provider='doubao')
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,stream=Chunks()))) as client:
            provider=DoubaoSpeech(settings,client)
            cache=SimpleNamespace(settings=settings,store=store,identity={'provider':'doubao','format':'mp3'})
            events=speech_events(cache,'private',42,prepare=lambda key:(provider,'op'),shared_only=False,phrases=(),lease=lease)
            self.assertEqual((await anext(events))['type'],'start')
            self.assertEqual((await asyncio.wait_for(anext(events),1))['type'],'chunk')
            self.assertFalse(saved)
            release.set()
            self.assertEqual((await anext(events))['type'],'done')
            await events.aclose()
            self.assertTrue(next(iter(saved.values())).startswith(b'RIFF'))
            self.assertEqual(statuses,[('op','completed')])
            saved.clear();statuses.clear();release.clear()
            events=speech_events(cache,'private',43,prepare=lambda key:(provider,'op2'),shared_only=False,phrases=(),lease=lease)
            await anext(events);await anext(events);await events.aclose()
            self.assertFalse(saved);self.assertFalse(statuses)

    async def test_completion_does_not_wait_for_64k_or_connection_eof(self):
        stream = CompletionStream()
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(200, stream=stream))) as client:
            audio = await DoubaoSpeech(Settings(_env_file=None, app_env='local'), client).synthesize('测试')
        self.assertEqual(audio, b'ID3-audio')
        self.assertTrue(stream.closed)

    async def test_only_known_rejections_are_safe_for_manual_retry(self):
        for status in (400, 401, 403, 404, 422, 429, 500, 503):
            calls = []
            def upstream(request):
                calls.append(request)
                return httpx.Response(status, text='secret provider message must stay private')
            async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
                with self.assertRaises(ProviderError) as caught:
                    await DoubaoSpeech(Settings(_env_file=None, app_env='local'), client).synthesize('测试')
            self.assertEqual(caught.exception.retry_safe, status < 500)
            self.assertEqual(len(calls), 1)
            self.assertNotIn('secret', str(caught.exception))

    async def test_incomplete_audio_remains_uncertain(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(200, content=b'{"code":0,"data":"SUQz"}\n'))) as client:
            with self.assertRaises(ProviderError) as caught:
                await DoubaoSpeech(Settings(_env_file=None, app_env='local'), client).synthesize('测试')
        self.assertFalse(caught.exception.retry_safe)
