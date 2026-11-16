"""Isolated security regressions; all provider traffic uses MockTransport."""
import asyncio
import json
import tempfile
import subprocess
import sys
import time
import unittest
from contextlib import AsyncExitStack
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

import httpx
from pydantic import ValidationError

from backend.app import create_app
from backend.config import Settings
from backend.contracts import Reply
from backend.coordination import GuardError
from backend.store import Store


class SecurityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.stack = AsyncExitStack()
        self.calls = []

    async def asyncTearDown(self):
        await self.stack.aclose()
        self.tmp.cleanup()

    def settings(self, **changes):
        values = dict(_env_file=None, database_path=self.root / 'test.db',
                      static_dir=self.root / 'missing',
                      app_env='production', cookie_secure=True, allowed_origins='https://example.com', llm_api_key='owner-should-never-be-used',
                      tts_api_key='owner-tts-should-never-be-used', tts_provider='openai',
                      min_free_disk_mb=0, requests_per_minute=1000)
        values.update(changes)
        if values['app_env'] == 'local':
            values.update(cookie_secure=False, allowed_origins='http://localhost:8000')
        return Settings(**values)

    async def upstream(self, request):
        self.calls.append((request.url.path, request.headers.get('authorization')))
        await asyncio.sleep(.05)
        if request.url.path.endswith('/audio/speech'):
            return httpx.Response(200, content=b'ID3-mock-audio', headers={'content-type': 'audio/mpeg'})
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'text': '测试回答', 'emotion': 'neutral'})}}]})

    async def client(self, settings=None, handler=None):
        settings = settings or self.settings()
        origin = 'https://example.com' if settings.app_env == 'production' else 'http://localhost:8000'
        app = create_app(settings, httpx.MockTransport(handler or self.upstream))
        await self.stack.enter_async_context(app.router.lifespan_context(app))
        client = await self.stack.enter_async_context(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=origin,
            headers={'X-Whale-Client': 'web', 'Origin': origin}))
        return client, app

    async def connect(self, client):
        self.assertEqual((await client.get('/api/session')).status_code, 200)

    async def test_manual_speech_retry_reports_active_locks_without_waiting(self):
        c, app = await self.client(self.settings(tts_provider='doubao'))
        await self.connect(c)
        acquire = app.state.store.acquire_lease
        for endpoint in ('/api/tts', '/api/tts/stream'):
            for prefix in ('request:tts:', 'audio:'):
                def busy(name, *args):
                    return 'busy' if name.startswith(prefix) else acquire(name, *args)
                with patch.object(app.state.store, 'acquire_lease', side_effect=busy):
                    response = await asyncio.wait_for(c.post(endpoint, json={'preset':'welcome','retry':True}, headers={'X-TTS-Key':'test-key'}), 1)
                data = json.loads(response.text.splitlines()[-1])
                self.assertEqual(data['code'], 'request_processing')
                self.assertIn('上一条语音', data['detail'])
        self.assertEqual(self.calls, [])

    async def test_unexpected_speech_failure_is_classified_and_logs_no_exception_secret(self):
        c, app = await self.client(self.settings(tts_provider='doubao'))
        await self.connect(c)
        with patch.object(app.state.store, 'cached_speech', side_effect=RuntimeError('sensitive-value')):
            with self.assertLogs('backend.app', level='ERROR') as logs:
                response = await c.post('/api/tts/stream', json={'preset':'welcome'}, headers={'X-TTS-Key':'test-key'})
        data = json.loads(response.text.splitlines()[-1])
        self.assertEqual(data['code'], 'speech_processing_failed')
        self.assertIn('服务端语音处理失败', data['detail'])
        self.assertNotIn('sensitive-value', response.text + ''.join(logs.output))

    async def chat(self, client, text='普通测试消息', request_id=None, key='user-key'):
        return await client.post('/api/chat', json={'text': text, 'request_id': request_id or str(uuid4())},
                                 headers={'X-LLM-Key': key} if key else {})

    async def test_missing_key_never_falls_back_and_fixed_reply_is_free(self):
        c, app = await self.client(); await self.connect(c)
        response = await self.chat(c, key=None)
        self.assertEqual(response.status_code, 428)
        self.assertEqual(response.json()['code'], 'credentials_required')
        self.assertEqual((await self.chat(c, text='你真可爱', key=None)).status_code, 200)
        self.assertEqual(self.calls, [])
        with app.state.store.connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM usage_counters WHERE kind='calls'").fetchone()[0], 0)

    async def test_chat_rejection_can_retry_same_turn_after_key_correction(self):
        calls = []
        async def provider(request):
            calls.append(request.headers['authorization'])
            if len(calls) == 1:
                return httpx.Response(401, text='private upstream detail')
            return await self.upstream(request)
        c, app = await self.client(handler=provider); await self.connect(c)
        rid = str(uuid4())
        rejected = await self.chat(c, request_id=rid, key='wrong-key')
        self.assertEqual(rejected.status_code, 502)
        self.assertIn('HTTP 401', rejected.json()['detail'])
        self.assertNotIn('private', rejected.text)
        self.assertEqual(len(calls), 1)
        retried = await self.chat(c, request_id=rid, key='corrected-key')
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(calls, ['Bearer wrong-key', 'Bearer corrected-key'])
        self.assertEqual((await self.chat(c, request_id=rid)).json(), retried.json())
        self.assertEqual(len(calls), 2)

    async def test_chat_uncertain_server_error_does_not_repeat_provider_call(self):
        calls = []
        def provider(request):
            calls.append(request)
            return httpx.Response(503)
        c, _ = await self.client(handler=provider); await self.connect(c)
        rid = str(uuid4())
        self.assertEqual((await self.chat(c, request_id=rid)).status_code, 502)
        again = await self.chat(c, request_id=rid)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()['code'], 'request_uncertain')
        self.assertEqual(len(calls), 1)

    async def test_local_fixed_replies_work_without_key_and_other_messages_require_it(self):
        from backend.quick_replies import QUICK_REPLIES
        c, _ = await self.client(self.settings(app_env='local', llm_api_key=''))
        await self.connect(c)
        self.assertNotIn('mode', (await c.get('/api/config')).json())
        for text in ('你真可爱', '今天有点累', '没token了怎么办', '我有一个好点子', '来玩你画我猜吧'):
            result = await self.chat(c, text=text, key=None)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['assistant']['text'], QUICK_REPLIES[text].text)
        result = await self.chat(c, text='请帮我安排今天的学习计划', key=None)
        self.assertEqual(result.status_code, 428)
        self.assertEqual(result.json()['code'], 'server_credentials_required')
        self.assertEqual(self.calls, [])
        configured, _ = await self.client(self.settings(app_env='local', llm_api_key='configured-test-key'))
        await self.connect(configured)
        result = await self.chat(configured, text='请帮我安排今天的学习计划', key='ignored-visitor-key')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1], 'Bearer configured-test-key')
        self.assertEqual((await configured.get('/api/config')).json()['app_env'], 'local')

    async def test_same_request_two_app_instances_only_one_paid_call(self):
        a, _ = await self.client(); b, _ = await self.client()
        await self.connect(a); b.cookies.update(a.cookies)
        request_id = str(uuid4())
        results = await asyncio.gather(self.chat(a, request_id=request_id), self.chat(b, request_id=request_id))
        self.assertEqual([r.status_code for r in results], [200, 200])
        self.assertEqual(results[0].json(), results[1].json())
        self.assertEqual(len(self.calls), 1)

    async def test_concurrent_users_credentials_isolated_and_not_persisted(self):
        a, app = await self.client(); b, _ = await self.client()
        await self.connect(a); await self.connect(b)
        results = await asyncio.gather(self.chat(a, key='visitor-key-one'), self.chat(b, key='visitor-key-two'))
        self.assertEqual([r.status_code for r in results], [200, 200])
        self.assertEqual({x[1] for x in self.calls}, {'Bearer visitor-key-one', 'Bearer visitor-key-two'})
        with app.state.store.connection() as db:
            dump = '\n'.join(db.iterdump())
        self.assertNotIn('visitor-key-', dump)
        self.assertNotIn('owner-should', dump)

    async def test_server_budget_survives_clear_and_new_session_same_ip(self):
        c, app = await self.client(self.settings(app_env='local', server_daily_budgets_enabled=True, daily_ip_calls=1)); await self.connect(c)
        self.assertEqual((await self.chat(c)).status_code, 200)
        self.assertEqual((await c.delete('/api/session/messages')).status_code, 200)
        self.assertEqual((await self.chat(c)).status_code, 429)
        c.cookies.clear(); await self.connect(c)
        self.assertEqual((await self.chat(c)).status_code, 429)
        self.assertEqual(len(self.calls), 1)

    async def test_local_server_has_no_daily_budget_by_default(self):
        settings = self.settings(app_env='local', daily_session_calls=1, daily_session_tokens=1)
        self.assertFalse(settings.server_daily_budgets_enabled)
        c, _ = await self.client(settings); await self.connect(c)
        self.assertEqual((await self.chat(c, text='第一条', key=None)).status_code, 200)
        self.assertEqual((await self.chat(c, text='第二条', key=None)).status_code, 200)
        self.assertEqual(len(self.calls), 2)

    async def test_shared_tts_cross_worker_dedup_and_cache_without_key(self):
        a, _ = await self.client(); b, _ = await self.client()
        await self.connect(a); await self.connect(b)
        async def speak(c):
            return await c.post('/api/tts', json={'preset': 'welcome'}, headers={'X-TTS-Key': 'tts-visitor'})
        results = await asyncio.gather(speak(a), speak(b))
        self.assertEqual([r.status_code for r in results], [200, 200])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1], 'Bearer tts-visitor')
        await a.delete('/api/session/messages')
        cached = await a.post('/api/tts', json={'preset': 'welcome'})
        self.assertEqual(cached.status_code, 200)
        self.assertEqual(cached.content, results[0].content)
        self.assertEqual(len(self.calls), 1)

    async def test_tts_explicit_rejection_can_be_retried_manually(self):
        calls = []
        def upstream(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(401)
            return httpx.Response(200, content=b'ID3-audio', headers={'content-type': 'audio/mpeg'})
        c, _ = await self.client(handler=upstream)
        await self.connect(c)
        first = await c.post('/api/tts', json={'preset': 'welcome'}, headers={'X-TTS-Key': 'visitor-tts'})
        self.assertEqual(first.status_code, 502)
        self.assertEqual(len(calls), 1)
        second = await c.post('/api/tts', json={'preset': 'welcome'}, headers={'X-TTS-Key': 'visitor-tts'})
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(len(calls), 2)

    async def test_uncertain_tts_requires_explicit_replay_before_resubmitting(self):
        calls = []
        def upstream(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(503)
            return httpx.Response(200, content=b'ID3-audio', headers={'content-type':'audio/mpeg'})
        c, _ = await self.client(handler=upstream)
        await self.connect(c)
        headers = {'X-TTS-Key':'visitor-tts'}
        first = await c.post('/api/tts', json={'preset':'welcome'}, headers=headers)
        self.assertEqual(first.status_code, 502)
        automatic = await c.post('/api/tts', json={'preset':'welcome'}, headers=headers)
        self.assertEqual(automatic.status_code, 409)
        self.assertIn('手动重试', automatic.json()['detail'])
        self.assertEqual(len(calls), 1)
        manual = await c.post('/api/tts', json={'preset':'welcome','retry':True}, headers=headers)
        self.assertEqual(manual.status_code, 200, manual.text)
        self.assertEqual(len(calls), 2)

    async def test_byok_ignores_old_daily_budgets_for_chat_and_tts(self):
        limits = {'daily_'+scope+'_'+kind: 1 for scope in ('session','ip','global') for kind in ('calls','tokens','tts_chars')}
        c, app = await self.client(self.settings(**limits)); await self.connect(c)
        bucket = (int(time.time()) + 8*3600)//86400
        with app.state.store.connection() as db:
            for kind in ('calls','tokens','tts_chars'):
                db.execute('INSERT INTO usage_counters VALUES (?,?,?,?,?)', ('global',kind,bucket,10_000_000,int(time.time())+86400))
        self.assertEqual((await self.chat(c, text='第一条')).status_code, 200)
        self.assertEqual((await self.chat(c, text='第二条')).status_code, 200)
        voice = await c.post('/api/tts', json={'preset':'welcome'}, headers={'X-TTS-Key':'visitor-key'})
        self.assertEqual(voice.status_code, 200, voice.text)
        self.assertEqual(len(self.calls), 3)
        with app.state.store.connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM usage_counters WHERE kind IN ('calls','tokens','tts_chars')").fetchone()[0], 3)
            self.assertTrue(all(row[0] == 10_000_000 for row in db.execute("SELECT used FROM usage_counters WHERE kind IN ('calls','tokens','tts_chars')")))

    async def test_llm_only_chat_is_text_only_except_existing_shared_audio(self):
        c, app = await self.client(); await self.connect(c)
        missing = await c.post('/api/tts', json={'preset': 'welcome'})
        self.assertEqual(missing.status_code, 204)
        self.assertEqual(self.calls, [])
        reply = await self.chat(c)
        self.assertEqual(reply.status_code, 200)
        body = {'message_id': reply.json()['assistant']['id']}
        quiet = await c.post('/api/tts', json=body)
        self.assertEqual(quiet.status_code, 204)
        self.assertEqual(quiet.content, b'')
        self.assertEqual(len(self.calls), 1)  # Only the LLM was called.
        voiced = await c.post('/api/tts', json=body, headers={'X-TTS-Key': 'visitor-tts'})
        self.assertEqual(voiced.status_code, 200)
        self.assertEqual(len(self.calls), 2)
        # Removing the optional key permits shared phrases only, even when
        # ordinary audio was cached earlier in the same session.
        self.assertEqual((await c.post('/api/tts', json=body)).status_code, 204)
        self.assertEqual(len(self.calls), 2)
        with app.state.store.connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM usage_counters WHERE kind IN ('calls','tokens','tts_chars')").fetchone()[0], 0)

    async def test_uncertain_paid_request_not_automatically_repeated(self):
        async def broken(request):
            self.calls.append(request.url.path)
            raise httpx.ReadTimeout('mock', request=request)
        c, _ = await self.client(handler=broken); await self.connect(c)
        request_id = str(uuid4())
        self.assertEqual((await self.chat(c, request_id=request_id)).status_code, 502)
        retry = await self.chat(c, request_id=request_id)
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(retry.json()['code'], 'request_uncertain')
        self.assertEqual(len(self.calls), 1)

    async def test_provider_has_total_deadline(self):
        async def slow(request):
            await asyncio.sleep(5)
            return await self.upstream(request)
        c, _ = await self.client(self.settings(request_timeout=1), slow); await self.connect(c)
        started = time.monotonic()
        self.assertEqual((await self.chat(c)).status_code, 502)
        self.assertLess(time.monotonic() - started, 3)

    async def test_message_audio_retention_and_shared_survives(self):
        settings = self.settings(max_session_messages=20, max_session_audio_mb=1)
        store = Store(settings.database_path, settings)
        session = store.session(store.create_session())
        for n in range(15):
            result = store.save_turn(session, str(uuid4()), str(n), Reply(text='普通回复'))
            store.cache_speech(str(n), b'x' * (150 * 1024), result['assistant']['id'])
        store.cache_speech('shared', b'fixed')
        with store.connection() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM messages').fetchone()[0], 20)
            self.assertLessEqual(db.execute('SELECT SUM(length(audio)) FROM speech_cache WHERE message_id IS NOT NULL').fetchone()[0], 1024 * 1024)
            db.execute('UPDATE speech_cache SET created_at=0 WHERE message_id IS NOT NULL')
        store.maintenance()
        with store.connection() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM speech_cache').fetchone()[0], 1)
        store.clear(session)
        self.assertEqual(store.cached_speech('shared'), b'fixed')
        self.assertEqual(store.affection(session), 60)

    async def test_expired_audio_is_replaced_and_oversize_is_not_silently_evicted(self):
        settings = self.settings(max_session_audio_mb=1)
        store = Store(settings.database_path, settings)
        session = store.session(store.create_session())
        message = store.save_turn(session, str(uuid4()), 'test', Reply(text='ordinary'))['assistant']['id']
        store.cache_speech('same-key', b'old', message)
        with store.connection() as db:
            db.execute('UPDATE speech_cache SET created_at=0')
        self.assertIsNone(store.cached_speech('same-key'))
        store.cache_speech('same-key', b'new', message)
        self.assertEqual(store.cached_speech('same-key'), b'new')
        with self.assertRaises(GuardError):
            store.cache_speech('too-big', b'x' * (1024 * 1024 + 1), message)
        self.assertEqual(store.cached_speech('same-key'), b'new')

    async def test_persistent_lease_and_session_cap(self):
        settings = self.settings(max_sessions=1)
        a = Store(settings.database_path, settings); b = Store(settings.database_path, settings)
        a.create_session()
        with self.assertRaises(GuardError): b.create_session()
        self.assertEqual(a.acquire_lease('request:a', 'worker-a', 60, 1), 'acquired')
        self.assertEqual(b.acquire_lease('request:a', 'worker-b', 60, 1), 'busy')
        self.assertEqual(b.acquire_lease('request:b', 'worker-b', 60, 1), 'full')
        b.release_lease('request:a', 'wrong-owner')
        self.assertEqual(b.acquire_lease('request:a', 'worker-b', 60, 1), 'busy')
        a.release_lease('request:a', 'worker-a')
        self.assertEqual(b.acquire_lease('request:a', 'worker-b', 60, 1), 'acquired')

    async def test_production_fail_closed_secure_cookie_and_no_owner_key(self):
        for changes in ({'cookie_secure': False}, {'allowed_origins': 'http://example.com'}):
            values = dict(app_env='production', cookie_secure=True, allowed_origins='https://example.com') | changes
            with self.assertRaises(ValidationError): self.settings(**values)
        settings = self.settings(app_env='production', cookie_secure=True, allowed_origins='https://example.com')
        self.assertEqual(settings.llm_api_key.get_secret_value(), '')
        self.assertEqual(settings.tts_api_key.get_secret_value(), '')
        self.assertEqual(settings.doubao_tts_api_key.get_secret_value(), '')
        c, _ = await self.client(settings)
        self.assertEqual((await c.get('/api/config')).json()['app_env'], 'production')
        self.assertEqual((await c.get('http://example.com/api/session')).status_code, 400)
        self.assertEqual((await c.get('https://evil.example/api/session')).status_code, 400)
        result = await c.get('https://example.com/api/session')
        self.assertEqual(result.status_code, 200)
        self.assertIn('Secure', result.headers['set-cookie'])
        self.assertIn('HttpOnly', result.headers['set-cookie'])

    async def test_lease_is_visible_in_a_separate_python_process(self):
        settings = self.settings()
        store = Store(settings.database_path, settings)
        store.acquire_lease('request:process-test', 'parent', 60, 1)
        script = "from pathlib import Path; import sys; from backend.store import Store; s=Store(Path(sys.argv[1])); print(s.acquire_lease('request:process-test','child',60,1)); print(s.acquire_lease('request:other','child',60,1))"
        result = await asyncio.to_thread(subprocess.run, [sys.executable, '-c', script, str(settings.database_path)], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ['busy', 'full'])

    async def test_game_reward_remains_server_owned(self):
        settings = self.settings()
        store = Store(settings.database_path, settings)
        session = store.session(store.create_session())
        result = store.save_turn(session, str(uuid4()), '继续玩', Reply(text='继续', topic='drawing_game', affection_delta=10))
        self.assertEqual(result['affection'], 60)
        result = store.save_turn(session, str(uuid4()), '答案', Reply(text='Bingo', topic='drawing_game', affection_delta=10), drawing_result={'round_id': 'test-round', 'correct': True}, game_day='2026-11-15')
        self.assertEqual(result['affection'], 65)
        store.clear(session)
        self.assertEqual(store.affection(session), 60)


if __name__ == '__main__':
    unittest.main()
