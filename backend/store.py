import hashlib
import json
import secrets
import sqlite3
import time
import shutil
from contextlib import contextmanager
from pathlib import Path

from .contracts import Reply, normalize_props, normalize_emotion
from .drawing_game import DRAWINGS
from .config import Settings
from .coordination import GuardError


class DailyGameLimit(Exception):
    pass


class Store:
    """Short-lived connections; each completed turn is committed atomically."""

    def __init__(self, path: Path, settings: Settings | None = None):
        self.settings = settings or Settings.model_construct()
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS request_leases (
                    name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS operation_claims (
                    name TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
                    expires INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS usage_counters (
                    scope TEXT NOT NULL, kind TEXT NOT NULL, bucket INTEGER NOT NULL,
                    used INTEGER NOT NULL, expires INTEGER NOT NULL,
                    PRIMARY KEY(scope,kind,bucket)
                );
                CREATE INDEX IF NOT EXISTS usage_expiry ON usage_counters(expires);

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
                    affection INTEGER NOT NULL DEFAULT 60
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL, text TEXT NOT NULL,
                    emotion TEXT, action TEXT, props TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, id);
                CREATE TABLE IF NOT EXISTS turns (
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    request_id TEXT NOT NULL, input TEXT NOT NULL, response TEXT NOT NULL,
                    PRIMARY KEY(session_id, request_id)
                );
                CREATE TABLE IF NOT EXISTS speech_cache (
                    cache_key TEXT PRIMARY KEY, audio BLOB NOT NULL,
                    created_at INTEGER NOT NULL,
                    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS drawing_rounds (
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    round_id TEXT NOT NULL, drawing TEXT NOT NULL, solved INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(session_id, round_id)
                );
                CREATE TABLE IF NOT EXISTS drawing_state (
                    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
                    version INTEGER NOT NULL DEFAULT 0, data TEXT
                );
                CREATE TABLE IF NOT EXISTS drawing_daily (
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    day TEXT NOT NULL,
                    PRIMARY KEY(session_id, day)
                );
            """)
            # Serialize the additive migration across concurrent server starts.
            db.execute("BEGIN IMMEDIATE")
            columns = {row["name"] for row in db.execute("PRAGMA table_info(messages)")}
            if "props" not in columns:
                db.execute("ALTER TABLE messages ADD COLUMN props TEXT NOT NULL DEFAULT '[]'")
            if "topic" not in columns:
                db.execute("ALTER TABLE messages ADD COLUMN topic TEXT")
            if "affection_change" not in columns:
                db.execute("ALTER TABLE messages ADD COLUMN affection_change INTEGER")
            if "affection_delta" not in columns:
                db.execute("ALTER TABLE messages ADD COLUMN affection_delta INTEGER NOT NULL DEFAULT 0")
                # Older turn responses retained the score even though the
                # messages table dropped it. Restore known scores once.
                for turn in db.execute("SELECT session_id,response FROM turns").fetchall():
                    try:
                        assistant = json.loads(turn["response"])["assistant"]
                        delta = assistant.get("affection_delta", 0)
                        if type(delta) is int and -10 <= delta <= 10:
                            db.execute("UPDATE messages SET affection_delta=? WHERE session_id=? AND id=? AND role='assistant'",
                                       (delta, turn["session_id"], assistant["id"]))
                    except (ValueError, KeyError, TypeError, AttributeError):
                        continue
            session_columns = {row["name"] for row in db.execute("PRAGMA table_info(sessions)")}
            if "affection" not in session_columns:
                db.execute("ALTER TABLE sessions ADD COLUMN affection INTEGER NOT NULL DEFAULT 60")
            speech_columns = {row["name"] for row in db.execute("PRAGMA table_info(speech_cache)")}
            if "message_id" not in speech_columns:
                db.execute("ALTER TABLE speech_cache ADD COLUMN message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE")
            db.execute("CREATE INDEX IF NOT EXISTS speech_cache_message ON speech_cache(message_id)")
            round_columns = {row["name"] for row in db.execute("PRAGMA table_info(drawing_rounds)")}
            if "payload" not in round_columns:
                db.execute("ALTER TABLE drawing_rounds ADD COLUMN payload TEXT")
            if "ready_at" not in round_columns:
                db.execute("ALTER TABLE drawing_rounds ADD COLUMN ready_at REAL NOT NULL DEFAULT 0")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def key(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def session(self, token: str | None) -> str | None:
        if not token or len(token) > 100:
            return None
        key = self.key(token)
        with self.connection() as db:
            row = db.execute("SELECT id FROM sessions WHERE id=? AND created_at>?", (key, int(time.time()) - self.settings.session_retention_days * 86400)).fetchone()
            return row["id"] if row else None

    def create_session(self) -> str:
        self.check_disk()
        token = secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM sessions WHERE created_at<?", (int(time.time()) - self.settings.session_retention_days * 86400,))
            if db.execute("SELECT count(*) FROM sessions").fetchone()[0] >= self.settings.max_sessions:
                raise GuardError("体验人数已达上限，请稍后再试。", 503)
            db.execute("INSERT INTO sessions(id,created_at) VALUES (?,?)", (self.key(token), int(time.time())))
        return token

    def affection(self, session: str) -> int:
        with self.connection() as db:
            row = db.execute("SELECT affection FROM sessions WHERE id=?", (session,)).fetchone()
            return int(row["affection"]) if row else 0

    def history(self, session: str, limit: int = 100) -> list[dict]:
        with self.connection() as db:
            rows = db.execute("SELECT id,role,text,emotion,action,props,topic,affection_change,affection_delta FROM messages WHERE session_id=? ORDER BY id DESC LIMIT ?", (session, limit)).fetchall()
            return [{**dict(row), "props": normalize_props(json.loads(row["props"])),
                     "emotion": normalize_emotion(row["emotion"]) if row["role"] == "assistant" else row["emotion"]}
                    for row in reversed(rows)]

    def speech_text(self, session: str, message_id: int) -> str | None:
        with self.connection() as db:
            row = db.execute("SELECT text FROM messages WHERE session_id=? AND id=? AND role='assistant'", (session, message_id)).fetchone()
            return row["text"] if row else None

    def cached_speech(self, cache_key: str) -> bytes | None:
        with self.connection() as db:
            row = db.execute("SELECT audio FROM speech_cache WHERE cache_key=? AND (message_id IS NULL OR created_at>?)", (cache_key, int(time.time())-self.settings.audio_retention_days*86400)).fetchone()
            return bytes(row["audio"]) if row and row["audio"] else None

    def cache_speech(self, cache_key: str, audio: bytes, message_id: int | None = None):
        if not audio:
            raise ValueError("Cannot cache empty audio")
        self.check_disk()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if message_id is not None:
                shared = db.execute("SELECT COALESCE(SUM(length(audio)),0) FROM speech_cache WHERE message_id IS NULL").fetchone()[0]
                available = min(self.settings.max_session_audio_mb * 1024 * 1024, self.settings.max_audio_cache_mb * 1024 * 1024 - shared)
                if len(audio) > available:
                    raise GuardError("这段音频超过缓存容量，请联系维护者调整上限。", 503, "storage_full")
            # Replace expired entries as well: INSERT OR IGNORE would discard
            # newly generated audio, then pruning would remove the expired row.
            # A message may have been cleared while its audio was being generated.
            db.execute("""INSERT OR REPLACE INTO speech_cache(cache_key,audio,created_at,message_id)
                SELECT ?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM messages WHERE id=?)""",
                (cache_key, audio, int(time.time()), message_id, message_id, message_id))
            self._prune_audio(db)

    def previous_turn(self, session: str, request_id: str) -> tuple[str, dict] | None:
        with self.connection() as db:
            row = db.execute("SELECT input,response FROM turns WHERE session_id=? AND request_id=?", (session, request_id)).fetchone()
            if not row:
                return None
            result = json.loads(row["response"])
            result["assistant"].setdefault("props", [])
            result["assistant"]["emotion"] = normalize_emotion(result["assistant"].get("emotion"))
            return row["input"], result

    def game_completed(self, session: str, day: str) -> bool:
        with self.connection() as db:
            return db.execute("SELECT 1 FROM drawing_daily WHERE session_id=? AND day=?", (session, day)).fetchone() is not None

    def save_turn(self, session: str, request_id: str, text: str, reply: Reply, *, request_input: str | None = None, drawing_result: dict | None = None, game_day: str | None = None) -> dict:
        # Game rewards are server-owned: every intermediate game reply is zero,
        # irrespective of the model's score. Only a verified final answer with
        # the atomic daily completion record earns the fixed five points.
        if reply.topic == "drawing_game" or drawing_result is not None:
            reward = 5 if game_day is not None and drawing_result and drawing_result.get("correct") else 0
            reply = reply.model_copy(update={"affection_delta": reward})
        self.check_disk()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            previous_affection = int(db.execute("SELECT affection FROM sessions WHERE id=?", (session,)).fetchone()["affection"])
            if game_day is not None:
                # The unique daily record and +5 award commit together, including
                # when two worker processes receive different correct attempts.
                cursor = db.execute("INSERT OR IGNORE INTO drawing_daily(session_id,day) VALUES (?,?)", (session, game_day))
                if not cursor.rowcount:
                    raise DailyGameLimit()
            now = int(time.time())
            user_id = db.execute("INSERT INTO messages(session_id,role,text,created_at) VALUES (?,'user',?,?)", (session, text, now)).lastrowid
            assistant_id = db.execute("INSERT INTO messages(session_id,role,text,emotion,action,props,topic,created_at,affection_delta) VALUES (?,'assistant',?,?,?,?,?,?,?)", (session, reply.text, reply.emotion, reply.action, json.dumps(reply.props), reply.topic, now, reply.affection_delta)).lastrowid
            result = {"user": {"id": user_id, "role": "user", "text": text}, "assistant": {"id": assistant_id, "role": "assistant", **reply.model_dump()}}
            db.execute("INSERT INTO turns VALUES (?,?,?,?)", (session, request_id, request_input if request_input is not None else text, json.dumps(result, ensure_ascii=False)))
            db.execute("UPDATE sessions SET affection=MAX(0,MIN(300,affection+?)) WHERE id=?", (reply.affection_delta, session))
            result["affection"] = int(db.execute("SELECT affection FROM sessions WHERE id=?", (session,)).fetchone()["affection"])
            # Record the applied change, including clamping at zero/full score.
            # Keep NULL for old messages whose actual change was never recorded.
            change = result["affection"] - previous_affection
            result["assistant"]["affection_change"] = change
            db.execute("UPDATE messages SET affection_change=? WHERE id=?", (change, assistant_id))
            if drawing_result is not None:
                result["drawing"] = drawing_result
                if drawing_result["correct"]:
                    db.execute("UPDATE drawing_rounds SET solved=1 WHERE session_id=? AND round_id=?", (session, drawing_result["round_id"]))
            db.execute("UPDATE turns SET response=? WHERE session_id=? AND request_id=?", (json.dumps(result, ensure_ascii=False), session, request_id))
            db.execute("UPDATE operation_claims SET status='completed' WHERE name=?", ("turn:"+session+":"+request_id,))
            self._prune_messages(db, session)
            return result

    def clear(self, session: str):
        with self.connection() as db:
            db.execute("DELETE FROM messages WHERE session_id=?", (session,))
            db.execute("DELETE FROM turns WHERE session_id=?", (session,))
            db.execute("DELETE FROM drawing_rounds WHERE session_id=?", (session,))
            db.execute("DELETE FROM drawing_daily WHERE session_id=?", (session,))
            db.execute("INSERT INTO drawing_state(session_id,version,data) VALUES (?,1,NULL) ON CONFLICT(session_id) DO UPDATE SET version=version+1,data=NULL", (session,))
            db.execute("UPDATE sessions SET affection=60 WHERE id=?", (session,))

    def drawing_state(self, session: str) -> dict:
        with self.connection() as db:
            row = db.execute("SELECT version,data FROM drawing_state WHERE session_id=?", (session,)).fetchone()
            return {"version": row["version"], "state": json.loads(row["data"]) if row["data"] else None} if row else {"version": 0, "state": None}

    def save_drawing_state(self, session: str, version: int, state: dict) -> bool:
        with self.connection() as db:
            db.execute("INSERT OR IGNORE INTO drawing_state(session_id,version) VALUES (?,0)", (session,))
            return bool(db.execute("UPDATE drawing_state SET version=version+1,data=? WHERE session_id=? AND version=?", (json.dumps(state, ensure_ascii=False), session, version)).rowcount)

    def drawing_round(self, session: str, round_id: str):
        with self.connection() as db:
            row = db.execute("SELECT drawing,solved,payload,ready_at FROM drawing_rounds WHERE session_id=? AND round_id=?", (session, round_id)).fetchone()
            if not row:
                return None
            # Saved payloads preserve both prepared and older generated rounds.
            drawing = json.loads(row["payload"]) if row["payload"] else DRAWINGS[row["drawing"]]
            return {"drawing": drawing, "solved": row["solved"], "ready": time.time() >= row["ready_at"]}

    def recent_drawings(self, session: str) -> list[str]:
        with self.connection() as db:
            rows = db.execute("SELECT drawing,payload FROM drawing_rounds WHERE session_id=? ORDER BY rowid DESC LIMIT 19", (session,)).fetchall()
            return [(json.loads(row["payload"]) if row["payload"] else DRAWINGS[row["drawing"]])["name"] for row in rows]

    def save_drawing_round(self, session: str, round_id: str, drawing: dict, *, drawing_id: str = 'generated'):
        self.check_disk()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            duration = 2.5 * min(6500, max(3500, sum(len(points) for points in drawing["strokes"]) * 15)) / 1000
            db.execute("INSERT INTO drawing_rounds(session_id,round_id,drawing,payload,ready_at) VALUES (?,?,?,?,?)", (session, round_id, drawing_id, json.dumps(drawing, ensure_ascii=False), time.time() + duration))
            row = db.execute("SELECT data FROM drawing_state WHERE session_id=?", (session,)).fetchone()
            previous = json.loads(row["data"]) if row and row["data"] else {}
            state = {"mode":"character", "image":None, "round_id":round_id, "progress":0, "paused":False,
                     "can_confirm":False, "feedback":previous.get("feedback", "")}
            db.execute("INSERT INTO drawing_state(session_id,version,data) VALUES (?,1,?) ON CONFLICT(session_id) DO UPDATE SET version=version+1,data=excluded.data", (session,json.dumps(state, ensure_ascii=False)))
            db.execute("UPDATE operation_claims SET status='completed' WHERE name=?", ("round:"+session+":"+round_id,))
            self._prune_messages(db, session)

    def check_disk(self):
        if shutil.disk_usage(self.path.parent).free < self.settings.min_free_disk_mb * 1024 * 1024:
            raise GuardError("服务器存储空间不足，已暂停新增内容，请稍后再试。", 503, "storage_full")

    def acquire_lease(self, name, owner, ttl, limit=None):
        now = time.time()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM request_leases WHERE expires<?", (now,))
            if db.execute("SELECT 1 FROM request_leases WHERE name=?", (name,)).fetchone():
                return "busy"
            if limit is not None and db.execute("SELECT count(*) FROM request_leases WHERE name LIKE ?", (name.split(":", 1)[0] + ":%",)).fetchone()[0] >= limit:
                return "full"
            db.execute("INSERT INTO request_leases VALUES (?,?,?)", (name, owner, now+ttl))
            return "acquired"

    def release_lease(self, name, owner):
        with self.connection() as db:
            db.execute("DELETE FROM request_leases WHERE name=? AND owner=?", (name, owner))

    def _claim_operation(self, db, name, fingerprint, allow_completed=False):
        row = db.execute("SELECT * FROM operation_claims WHERE name=?", (name,)).fetchone()
        if row and row["expires"] > time.time() and not (allow_completed and row["status"] == "completed"):
            detail = "这段语音的上次合成结果未能确认，24 小时内不自动重复提交；请联系维护者核查。" if name.startswith("audio:") else "上次请求已经提交，结果未能确认或已被清理；如需重新提交，请再次发送（可能再次计费）。"
            raise GuardError(detail, 409, "request_uncertain")
        db.execute("INSERT OR REPLACE INTO operation_claims VALUES (?,?,'processing',?)", (name, fingerprint, int(time.time())+86400))

    def operation_status(self, name, status):
        with self.connection() as db:
            db.execute("UPDATE operation_claims SET status=? WHERE name=?", (status,name))

    def consume(self, charges, kind, period):
        """Atomic all-or-nothing limits; independent of deletable chat data."""
        now = int(time.time()); bucket = now // period
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            for scope, amount, maximum in charges:
                row = db.execute("SELECT used FROM usage_counters WHERE scope=? AND kind=? AND bucket=?", (scope,kind,bucket)).fetchone()
                if (row[0] if row else 0)+amount > maximum:
                    raise GuardError("请求过于频繁，请稍后再试。" if period==60 else "本日体验用量已达上限，请明天再来。", 429)
            for scope, amount, maximum in charges:
                db.execute("INSERT INTO usage_counters VALUES (?,?,?,?,?) ON CONFLICT(scope,kind,bucket) DO UPDATE SET used=used+excluded.used", (scope,kind,bucket,amount,(bucket+1)*period))

    def reserve_usage(self, session, ip, credential, *, tokens=0, tts_chars=0, operation=None, fingerprint="", allow_completed=False):
        # All dimensions commit together; failures/uncertain upstream outcomes
        # retain reservations rather than allowing free unlimited retries.
        now=int(time.time()); bucket=(now+8*3600)//86400; expiry=(bucket+1)*86400-8*3600
        scopes=[("session:"+session,"session"),("ip:"+ip,"ip"),("global","global")]
        if credential: scopes.append(("credential:"+credential,"ip"))
        dimensions=[("calls",1)] + ([("tokens",tokens)] if tokens else []) + ([("tts_chars",tts_chars)] if tts_chars else [])
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if operation:
                self._claim_operation(db, operation, fingerprint, allow_completed)
            # Visitors pay their own provider. Retain request deduplication, but
            # do not apply or accumulate site daily budgets in BYOK mode.
            if self.settings.credential_mode == "byok" or not self.settings.server_daily_budgets_enabled:
                return
            for scope, category in scopes:
                for kind, amount in dimensions:
                    maximum=getattr(self.settings,"daily_"+category+"_"+kind)
                    row=db.execute("SELECT used FROM usage_counters WHERE scope=? AND kind=? AND bucket=?",(scope,kind,bucket)).fetchone()
                    if (row[0] if row else 0)+amount>maximum:
                        raise GuardError("本日体验用量已达上限，请明天再来。")
            for scope, category in scopes:
                for kind, amount in dimensions:
                    db.execute("INSERT INTO usage_counters VALUES (?,?,?,?,?) ON CONFLICT(scope,kind,bucket) DO UPDATE SET used=used+excluded.used",(scope,kind,bucket,amount,expiry))

    def _prune_messages(self, db, session):
        limit=self.settings.max_session_messages
        db.execute("DELETE FROM messages WHERE session_id=? AND id NOT IN (SELECT id FROM messages WHERE session_id=? ORDER BY id DESC LIMIT ?)",(session,session,limit))
        db.execute("DELETE FROM turns WHERE session_id=? AND rowid NOT IN (SELECT rowid FROM turns WHERE session_id=? ORDER BY rowid DESC LIMIT ?)",(session,session,limit//2))
        # Only a bounded number of prior drawings are needed; retain the active
        # snapshot's round even when the user has repeatedly started new rounds.
        db.execute("DELETE FROM drawing_rounds WHERE session_id=? AND rowid NOT IN (SELECT rowid FROM drawing_rounds WHERE session_id=? ORDER BY rowid DESC LIMIT 20) AND round_id != COALESCE((SELECT json_extract(data,'$.round_id') FROM drawing_state WHERE session_id=?),'')",(session,session,session))

    def _prune_audio(self, db):
        mb=1024*1024
        db.execute("DELETE FROM speech_cache WHERE message_id IS NOT NULL AND created_at<?",(int(time.time())-self.settings.audio_retention_days*86400,))
        # Bound every session, then the total cache. Shared phrases have a
        # separate cap and are never evicted just because someone clears chat.
        totals={r[0]:r[1] for r in db.execute("SELECT m.session_id,SUM(length(c.audio)) FROM speech_cache c JOIN messages m ON m.id=c.message_id GROUP BY m.session_id")}
        for row in db.execute("SELECT c.cache_key,m.session_id,length(c.audio) FROM speech_cache c JOIN messages m ON m.id=c.message_id ORDER BY c.created_at,c.rowid").fetchall():
            if totals[row[1]]>self.settings.max_session_audio_mb*mb:
                db.execute("DELETE FROM speech_cache WHERE cache_key=?",(row[0],));totals[row[1]]-=row[2]
        shared=db.execute("SELECT COALESCE(SUM(length(audio)),0) FROM speech_cache WHERE message_id IS NULL").fetchone()[0]
        if shared>self.settings.max_shared_audio_mb*mb:
            raise GuardError("共享语音缓存已满，请联系维护者清理旧音色版本。",503,"storage_full")
        total=db.execute("SELECT COALESCE(SUM(length(audio)),0) FROM speech_cache").fetchone()[0]
        for row in db.execute("SELECT cache_key,length(audio) FROM speech_cache WHERE message_id IS NOT NULL ORDER BY created_at,rowid").fetchall():
            if total<=self.settings.max_audio_cache_mb*mb:break
            db.execute("DELETE FROM speech_cache WHERE cache_key=?",(row[0],));total-=row[1]
        if total>self.settings.max_audio_cache_mb*mb:
            raise GuardError("语音缓存已满，请联系维护者。",503,"storage_full")

    def maintenance(self):
        now=int(time.time())
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE created_at<?",(now-self.settings.session_retention_days*86400,))
            db.execute("DELETE FROM usage_counters WHERE expires<?",(now,))
            db.execute("DELETE FROM operation_claims WHERE expires<?",(now,))
            db.execute("DELETE FROM request_leases WHERE expires<?",(now,))
            for row in db.execute("SELECT id FROM sessions").fetchall():self._prune_messages(db,row[0])
            self._prune_audio(db)
        with self.connection() as db:
            db.execute("PRAGMA wal_checkpoint(PASSIVE)")
