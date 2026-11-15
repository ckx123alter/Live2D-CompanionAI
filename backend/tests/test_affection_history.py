import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock

from backend.config import Settings
from backend.contracts import Reply
from backend.store import Store
from backend.providers import OpenAIChat


class AffectionHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "history.sqlite3"
        self.settings = Settings.model_construct(min_free_disk_mb=0)
        self.store = Store(self.path, self.settings)
        self.session = self.store.key(self.store.create_session())

    def reply(self, delta, **kwargs):
        return self.store.save_turn(self.session, str(uuid4()), "测试消息",
                                    Reply(text="我记住这句话啦。", affection_delta=delta, **kwargs))

    def test_changes_survive_reload_and_are_session_scoped(self):
        first = self.reply(4)
        second = self.reply(-3)
        self.assertEqual(first["assistant"]["affection_change"], 4)
        self.assertEqual(second["assistant"]["affection_change"], -3)
        restored = Store(self.path, self.settings)
        replies = [row for row in restored.history(self.session) if row["role"] == "assistant"]
        self.assertEqual([row["affection_change"] for row in replies], [4, -3])
        self.assertEqual([row["affection_delta"] for row in replies], [4, -3])
        self.assertEqual(replies[0]["text"], first["assistant"]["text"])
        self.assertEqual(restored.history(restored.key(restored.create_session())), [])
        self.store.clear(self.session)
        self.assertEqual(self.store.history(self.session), [])
        self.assertEqual(self.store.affection(self.session), 60)

    def test_records_applied_change_at_score_limits_and_game_intermediate(self):
        with self.store.connection() as db:
            db.execute("UPDATE sessions SET affection=298 WHERE id=?", (self.session,))
        self.assertEqual(self.reply(10)["assistant"]["affection_change"], 2)
        self.assertEqual(self.reply(10)["assistant"]["affection_change"], 0)
        with self.store.connection() as db:
            db.execute("UPDATE sessions SET affection=2 WHERE id=?", (self.session,))
        self.assertEqual(self.reply(-10)["assistant"]["affection_change"], -2)
        self.assertEqual(self.reply(10, topic="drawing_game")["assistant"]["affection_change"], 0)
        scores = [row["affection_delta"] for row in self.store.history(self.session) if row["role"] == "assistant"]
        self.assertEqual(scores, [10, 10, -10, 0])

    def test_old_messages_keep_unknown_change_and_migration_is_repeatable(self):
        with self.store.connection() as db:
            db.execute("ALTER TABLE messages DROP COLUMN affection_change")
            db.execute("INSERT INTO messages(session_id,role,text,created_at) VALUES (?,'assistant','旧回复',0)", (self.session,))
        migrated = Store(self.path, self.settings)
        self.assertIsNone(migrated.history(self.session)[0]["affection_change"])
        Store(self.path, self.settings)

    def test_score_migration_restores_turn_scores_and_defaults_unknown_to_zero(self):
        self.reply(2)
        self.reply(-5)
        with self.store.connection() as db:
            db.execute("ALTER TABLE messages DROP COLUMN affection_delta")
            db.execute("INSERT INTO messages(session_id,role,text,created_at) VALUES (?,'assistant','更早的回复',0)", (self.session,))
        migrated = Store(self.path, self.settings)
        scores = [row["affection_delta"] for row in migrated.history(self.session) if row["role"] == "assistant"]
        self.assertEqual(scores, [2, -5, 0])
        self.assertEqual(migrated.affection(self.session), 57)

    def test_provider_history_keeps_scores_in_every_assistant_message(self):
        for delta in [2, -5, 0]:
            self.reply(delta)
        history = self.store.history(self.session)
        history += [{"role": "assistant", "text": "没有评分的旧消息"},
                    {"role": "assistant", "text": "空评分", "affection_delta": None}]
        provider = OpenAIChat(self.settings, None)
        provider.complete = AsyncMock(return_value='{"text":"测试回复","affection_delta":0}')
        asyncio.run(provider.reply(history, "新消息"))
        messages = provider.complete.call_args.args[0]
        scores = [json.loads(message["content"])["affection_delta"] for message in messages if message["role"] == "assistant"]
        self.assertEqual(scores, [2, -5, 0, 0, 0])


if __name__ == "__main__":
    unittest.main()
