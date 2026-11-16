import asyncio
import copy
import json
import math
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx

from backend.drawing_library import PREPARED_DRAWINGS, choose_drawing
from backend.drawing_game import BINGO_TEXT, WRONG_ANSWER_TEXT, matches_answer, confirms_guess
from backend.quick_replies import QUICK_REPLIES
from backend.providers import parse_reply
from backend.store import Store
from backend.tests import test_security as security


class DrawingGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await security.SecurityTests.asyncSetUp(self)
        self.picker = self.stack.enter_context(patch('backend.app.choose_drawing', return_value=('umbrella', copy.deepcopy(PREPARED_DRAWINGS['umbrella']))))

    asyncTearDown = security.SecurityTests.asyncTearDown
    settings = security.SecurityTests.settings
    client = security.SecurityTests.client
    connect = security.SecurityTests.connect
    chat = security.SecurityTests.chat
    upstream = security.SecurityTests.upstream

    async def round(self, c, request_id=None, key=None):
        return await c.post('/api/drawing/round', json={'request_id': request_id or str(uuid4())},
                            headers={'X-LLM-Key': key} if key else {})

    async def ready_round(self, c, progress=1):
        response = await self.round(c)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json(); snapshot = data['drawing_snapshot']
        # Simulate the server drawing deadline passing without a real sleep.
        with c._transport.app.state.store.connection() as db:
            db.execute('UPDATE drawing_rounds SET ready_at=0 WHERE round_id=?', (data['round_id'],))
        state = snapshot['state']; state.pop('round'); state['progress'] = progress
        self.assertEqual((await c.put('/api/drawing/state', json={'version': snapshot['version'], 'state': state})).status_code, 200)
        return data

    async def test_early_answers_and_forged_snapshots_are_rejected(self):
        c, app = await self.client(); await self.connect(c)
        data = (await self.round(c)).json()
        snapshot = data['drawing_snapshot']
        state = snapshot['state']; state.pop('round'); state['progress'] = 1
        response = await c.put('/api/drawing/state', json={'version':snapshot['version'], 'state':state})
        self.assertEqual(response.status_code, 409)
        answer = {'request_id':str(uuid4()), 'round_id':data['round_id'], 'text':'伞'}
        self.assertEqual((await c.post('/api/drawing/answer', json=answer)).status_code, 409)
        state['round_id'] = None; state['mode'] = 'user'
        self.assertEqual((await c.put('/api/drawing/state', json={'version':snapshot['version'], 'state':state})).status_code, 409)
        self.assertEqual((await c.get('/api/session')).json()['affection'], 60)
        await self.ready_round(c)
        self.assertEqual((await c.post('/api/drawing/answer', json=answer)).status_code, 200)
        self.assertEqual((await c.get('/api/session')).json()['affection'], 65)
        # The next day may start a user drawing, but cannot reactivate an old round.
        with patch('backend.app.game_day', return_value='2099-01-01'):
            snapshot = (await c.get('/api/drawing/state')).json()
            response = await c.put('/api/drawing/state', json={'version':snapshot['version'], 'state':{'mode':'user'}})
            self.assertEqual(response.status_code, 200)
            old_id = data['round_id']
            new = (await self.round(c)).json()['drawing_snapshot']
            stale = new['state']; stale.pop('round'); stale['round_id'] = old_id
            self.assertEqual((await c.put('/api/drawing/state', json={'version':new['version'], 'state':stale})).status_code, 409)
        # Clearing chat intentionally restores the daily game allowance.
        await c.delete('/api/session/messages')
        self.assertFalse((await c.get('/api/session')).json()['game_completed'])
        self.assertEqual((await self.round(c)).status_code, 200)

    async def test_prepared_round_is_private_persisted_and_free_without_keys(self):
        c, app = await self.client(); await self.connect(c)
        response = await self.round(c)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertNotIn('雨伞', response.text)
        self.assertNotIn('aliases', response.text)
        self.assertEqual(self.calls, [])
        restored = (await c.get('/api/session')).json()['drawing_snapshot']
        self.assertEqual(restored['state']['round']['strokes'], data['strokes'])
        other, _ = await self.client(); other.cookies.update(c.cookies)
        again = await self.round(other, data['round_id'])
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()['strokes'], data['strokes'])
        self.assertEqual(self.picker.call_count, 1)
        with app.state.store.connection() as db:
            self.assertEqual(db.execute('SELECT drawing FROM drawing_rounds').fetchone()[0], 'umbrella')
            self.assertEqual(db.execute("SELECT count(*) FROM usage_counters WHERE kind IN ('calls','tokens')").fetchone()[0], 0)

    async def test_concurrent_requests_and_reopen_keep_one_drawing(self):
        a, _ = await self.client(); b, _ = await self.client(); await self.connect(a); b.cookies.update(a.cookies)
        request_id = str(uuid4())
        results = await asyncio.gather(self.round(a, request_id), self.round(b, request_id))
        self.assertEqual([r.status_code for r in results], [200, 200])
        self.assertEqual(results[0].json(), results[1].json())
        self.assertEqual((await self.round(a)).json()['round_id'], request_id)
        self.assertEqual(self.picker.call_count, 1)
        self.assertEqual(self.calls, [])

    async def test_can_load_prepared_drawing_without_provider(self):
        c, _ = await self.client(self.settings(app_env='local', llm_api_key='')); await self.connect(c)
        self.assertEqual((await self.round(c)).status_code, 200)
        self.assertEqual(self.calls, [])

    async def test_aliases_trigger_fixed_bingo_and_reward_only_once(self):
        c, _ = await self.client(); await self.connect(c)
        await self.ready_round(c)
        request_id = str(uuid4())
        response = await self.chat(c, text='我猜是伞', request_id=request_id, key=None)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result['assistant']['text'], BINGO_TEXT)
        self.assertEqual(result['assistant']['action'], 'Lean')
        self.assertEqual(result['affection'], 65)
        self.assertTrue(result['drawing']['correct'])
        self.assertEqual((await self.chat(c, text='我猜是伞', request_id=request_id, key=None)).json(), result)
        self.assertEqual((await self.round(c)).status_code, 429)
        self.assertEqual(self.calls, [])

    async def test_semantic_guess_uses_fixed_bingo_and_settles_once(self):
        # Deliberately omit the broad alias to exercise the semantic fallback.
        drawing = copy.deepcopy(PREPARED_DRAWINGS['pencil']); drawing['aliases'] = ['铅笔']
        self.picker.return_value = ('pencil', drawing)
        async def handler(request):
            body = json.loads(request.content); self.calls.append(body)
            self.assertIn('铅笔', body['messages'][0]['content'])
            result = {'text': '就是铅笔，给你一朵小红花！', 'game_answer_correct': True, 'affection_delta': 10}
            return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result)}}]})
        c, app = await self.client(handler=handler); await self.connect(c)
        await self.ready_round(c)
        request_id = str(uuid4())
        result = (await self.chat(c, text='笔吗', request_id=request_id)).json()
        self.assertEqual(result['assistant']['text'], BINGO_TEXT)
        self.assertEqual(result['assistant']['emotion'], 'loving')
        self.assertEqual(result['assistant']['action'], 'Lean')
        self.assertEqual(result['affection'], 65)
        self.assertTrue(result['drawing']['correct'])
        self.assertNotIn('game_answer_correct', result['assistant'])
        self.assertEqual((await self.chat(c, text='笔吗', request_id=request_id, key=None)).json(), result)
        self.assertEqual(len(self.calls), 1)
        self.assertTrue((await c.get('/api/session')).json()['game_completed'])
        with app.state.store.connection() as db:
            self.assertEqual(db.execute('SELECT solved FROM drawing_rounds').fetchone()[0], 1)

    async def test_wrong_guess_hints_and_incomplete_drawing_do_not_reward(self):
        cases = [('扫把吗', False, 1, WRONG_ANSWER_TEXT),
                 ('给个提示', None, 1, '想想下雨时会用什么。'),
                 ('我猜是伞', True, .5, '还没画完呢。')]
        for text, verdict, progress, expected in cases:
            with self.subTest(text=text):
                async def handler(request):
                    result = {'text': expected, 'topic': 'drawing_game',
                              'game_intent': 'resume' if verdict is None else 'answer',
                              'game_answer_correct': verdict, 'affection_delta': 10}
                    return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result)}}]})
                c, _ = await self.client(handler=handler); await self.connect(c)
                await self.ready_round(c, progress)
                result = (await self.chat(c, text=text)).json()
                self.assertEqual(result['assistant']['text'], expected)
                self.assertEqual(result['affection'], 60)
                self.assertFalse((await c.get('/api/session')).json()['game_completed'])

    async def test_semantic_verdict_requires_real_boolean(self):
        for value in ('true', 'false', 1, 0, [], {}):
            self.assertIsNone(parse_reply(json.dumps({'text': '测试', 'game_answer_correct': value})).game_answer_correct)

    async def test_text_confirmation_uses_button_reply_without_paid_call_or_reward(self):
        for text in ('答对了！', '猜对了', '没错，就是这个', '是的', '对呀'):
            with self.subTest(text=text):
                c, _ = await self.client(); await self.connect(c)
                state = {'mode': 'user', 'can_confirm': True}
                self.assertEqual((await c.put('/api/drawing/state', json={'version': 0, 'state': state})).status_code, 200)
                result = (await self.chat(c, text=text, key=None)).json()
                self.assertEqual(result['assistant']['text'], QUICK_REPLIES['答对了！'].text)
                self.assertEqual(result['assistant']['game_intent'], 'confirm')
                self.assertEqual(result['assistant']['topic'], 'drawing_game')
                self.assertEqual(result['affection'], 60)
                self.assertFalse((await c.get('/api/session')).json()['game_completed'])
        self.assertEqual(self.calls, [])

    async def test_semantic_confirmation_is_scoped_to_user_drawing(self):
        async def handler(request):
            result = {'text': '猜中了！', 'game_intent': 'confirm', 'affection_delta': 0}
            return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result)}}]})
        for eligible in (True, False):
            c, _ = await self.client(handler=handler); await self.connect(c)
            state = {'mode': 'user', 'can_confirm': eligible}
            await c.put('/api/drawing/state', json={'version': 0, 'state': state})
            result = (await self.chat(c, text='哈哈居然让你认出来了')).json()
            self.assertEqual(result['assistant']['game_intent'], 'confirm' if eligible else 'none')
            self.assertEqual(result['affection'], 60)
            if eligible:
                self.assertEqual(result['assistant']['text'], QUICK_REPLIES['答对了！'].text)
        for text in ('没猜对', '你猜对了吗', '不是这个', '答对了吗？', '没错但是你的画不好看'):
            self.assertFalse(confirms_guess(text))

    async def test_twenty_drawings_valid_and_first_cycle_has_no_repeats(self):
        self.assertEqual(len(PREPARED_DRAWINGS), 20)
        recent = []
        for _ in range(40):
            key, drawing = choose_drawing(recent)
            self.assertNotIn(drawing['name'], recent[:19])
            self.assertTrue(matches_answer(drawing['name'], drawing))
            for path in drawing['strokes']:
                self.assertGreaterEqual(len(path), 2)
                self.assertTrue(all(math.isfinite(v) and 0 <= v <= 512 for p in path for v in p))
                self.assertTrue(all(math.dist(a, b) <= 5.02 for a, b in zip(path, path[1:])))
            recent.insert(0, drawing['name'])
        self.assertEqual(len(set(recent[:20])), 20)
        self.assertTrue(matches_answer('笔吗', PREPARED_DRAWINGS['pencil']))
        self.assertFalse(matches_answer('不是笔', PREPARED_DRAWINGS['pencil']))

    async def test_recent_history_and_old_generated_payload_survive(self):
        c, app = await self.client(); await self.connect(c)
        store = app.state.store
        with store.connection() as db:
            session = db.execute('SELECT id FROM sessions').fetchone()[0]
            db.execute("INSERT INTO drawing_rounds(session_id,round_id,drawing) VALUES (?,?,'fish')", (session, str(uuid4())))
        for key, drawing in PREPARED_DRAWINGS.items():
            store.save_drawing_round(session, str(uuid4()), drawing, drawing_id=key)
        self.assertEqual(len(store.recent_drawings(session)), 19)
        old = {'name': '旧画稿', 'aliases': ['旧画稿'], 'strokes': [[[10,10],[100,100]]]}
        rid = str(uuid4()); store.save_drawing_round(session, rid, old)
        self.assertEqual(Store(store.path, self.settings()).drawing_round(session, rid)['drawing'], old)


if __name__ == '__main__':
    unittest.main()
