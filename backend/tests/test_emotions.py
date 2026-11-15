import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from backend.config import Settings
from backend.contracts import EMOTIONS, LEGACY_EMOTIONS, Reply
from backend.providers import OpenAIChat, load_system_prompt, parse_reply
from backend.store import Store


class EmotionTests(unittest.TestCase):
    def test_legacy_tags_read_as_new_tags_without_reusing_old_ids(self):
        for old, new in LEGACY_EMOTIONS.items():
            self.assertNotIn(old, EMOTIONS)
            self.assertEqual(Reply(text="旧回复", emotion=old).emotion, new)
            self.assertEqual(parse_reply(json.dumps({"text":"旧回复", "emotion":old, "affection_delta":-2})).emotion, new)
        prompt = load_system_prompt()
        for old in LEGACY_EMOTIONS:
            self.assertNotIn(old + "=", prompt)

    def test_saved_history_retries_and_model_context_use_new_tags(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = Settings.model_construct(min_free_disk_mb=0)
            store = Store(Path(folder) / "test.sqlite3", settings)
            session = store.key(store.create_session())
            for old, new in LEGACY_EMOTIONS.items():
                saved = store.save_turn(session, old, "测试", Reply(text="旧回复", emotion=new))
                # Simulate records made before the rename, including retry data.
                saved["assistant"]["emotion"] = old
                with store.connection() as db:
                    db.execute("UPDATE messages SET emotion=? WHERE id=?", (old, saved["assistant"]["id"]))
                    db.execute("UPDATE turns SET response=? WHERE request_id=?", (json.dumps(saved), old))
                self.assertEqual(store.previous_turn(session, old)[1]["assistant"]["emotion"], new)
            history = store.history(session)
            self.assertEqual([row["emotion"] for row in history if row["role"] == "assistant"], list(LEGACY_EMOTIONS.values()))
            provider = OpenAIChat(settings, None)
            provider.complete = AsyncMock(return_value='{"text":"测试","emotion":"sadness","affection_delta":0}')
            asyncio.run(provider.reply(history, "测试"))
            messages = provider.complete.call_args.args[0]
            self.assertEqual([json.loads(row["content"])["emotion"] for row in messages if row["role"] == "assistant"], list(LEGACY_EMOTIONS.values()))


if __name__ == "__main__":
    unittest.main()
