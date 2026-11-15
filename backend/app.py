import asyncio
import json
import logging
from urllib.parse import urlsplit
from pydantic import SecretStr
from starlette.middleware.trustedhost import TrustedHostMiddleware

import hashlib
import hmac
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .coordination import GuardError, lease
from .config import Settings
from .contracts import ChatRequest, DrawingStateRequest, DrawingRequest, DrawingRoundRequest, DrawingAnswerRequest, LoginRequest, SpeechRequest
from .drawing_library import choose_drawing
from .drawing_game import matches_answer, answer_reply, game_day, daily_limit_reply, resume_reply, confirms_guess, DAILY_LIMIT_TEXT
from .providers import DoubaoSpeech, OpenAIChat, OpenAISpeech, ProviderError, load_system_prompt
from .store import Store, DailyGameLimit
from .speech_cache import CachedSpeech, WELCOME_TEXT
from .quick_replies import quick_reply

COOKIE = "whale_session"


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.store = Store(settings.database_path, settings)
        app.state.store.maintenance()
        # No retries on paid requests: uncertain outcomes must not silently bill twice.
        async with httpx.AsyncClient(timeout=settings.request_timeout, transport=transport, follow_redirects=False) as client:
            app.state.client = client
            provider = DoubaoSpeech(settings, client) if settings.tts_provider == "doubao" else OpenAISpeech(settings, client)
            app.state.speech = CachedSpeech(settings, provider, app.state.store)
            async def maintain():
                while True:
                    await asyncio.sleep(settings.maintenance_interval)
                    try:
                        await asyncio.to_thread(app.state.store.maintenance)
                    except Exception:
                        logging.getLogger(__name__).error("Storage maintenance failed; check database capacity and permissions")
            maintenance = asyncio.create_task(maintain())
            try:
                yield
            finally:
                maintenance.cancel()
                await asyncio.gather(maintenance, return_exceptions=True)
                await app.state.speech.close()

    app = FastAPI(title="鲸语 API", lifespan=lifespan)
    if settings.app_env == "production":
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", *[urlsplit(origin).hostname for origin in settings.origins]])

    @app.middleware("http")
    async def browser_boundary(request: Request, call_next):
        if settings.app_env == "production" and request.url.scheme != "https" and request.url.path != "/api/health":
            return JSONResponse({"detail": "本站仅接受 HTTPS，请检查可信反向代理配置。"}, status_code=400)
        if request.url.path.startswith("/api/"):
            if request.method in {"POST", "DELETE", "PUT", "PATCH"}:
                origin = request.headers.get("origin")
                # Every mutation uses JSON and a custom header. Cross-site forms
                # cannot supply these, and CORS is deliberately not enabled.
                if request.headers.get("x-whale-client") != "web" or (origin and origin.rstrip("/") not in settings.origins):
                    return JSONResponse({"detail": "请求来源不被允许。"}, status_code=403)
                if request.method in {"POST", "PUT"} and not request.headers.get("content-type", "").startswith("application/json"):
                    return JSONResponse({"detail": "请求必须使用 JSON。"}, status_code=415)
                # Bounded streaming read also rejects chunked oversized bodies.
                body = bytearray()
                try:
                    async with asyncio.timeout(15):
                        async for chunk in request.stream():
                            body.extend(chunk)
                            limit = 704 * 1024 if request.url.path in {"/api/drawing/guess", "/api/drawing/state"} else 16 * 1024
                            if len(body) > limit:
                                return JSONResponse({"detail": "请求内容过大。"}, status_code=413)
                except TimeoutError:
                    return JSONResponse({"detail": "上传超时。"}, status_code=408)
                request._body = bytes(body)
            response = await call_next(request)
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            if settings.app_env == "production":
                response.headers["Strict-Transport-Security"] = "max-age=31536000"
            return response
        return await call_next(request)

    @app.exception_handler(GuardError)
    async def guard_error(request: Request, error: GuardError):
        return JSONResponse({"detail": error.detail, "code": error.code}, status_code=error.status)

    @app.exception_handler(ProviderError)
    async def provider_error(request: Request, error: ProviderError):
        return JSONResponse({"detail": str(error)}, status_code=502)

    def cookie_session(request: Request) -> str | None:
        token = request.cookies.get(COOKIE, "")
        password = settings.app_password.get_secret_value()
        if password:
            token, separator, signature = token.partition(".")
            expected = hmac.new(password.encode(), token.encode(), hashlib.sha256).hexdigest()
            if not separator or not hmac.compare_digest(signature, expected):
                return None
        return app.state.store.session(token)

    def session(request: Request) -> str:
        key = cookie_session(request)
        if not key:
            raise HTTPException(401, "请重新连接会话。")
        return key

    def client_ip(request):
        return request.client.host if request.client else "unknown"

    def budget(request: Request, key: str | None = None, *, snapshot=False):
        maximum = 240 if snapshot else settings.requests_per_minute
        charges = [("ip:" + client_ip(request), 1, maximum)]
        if key:
            charges.append(("session:" + key, 1, maximum))
        app.state.store.consume(charges, "snapshot" if snapshot else "request", 60)

    def exclusive(key: str):
        return lease(app.state.store, "request:" + key, timeout=settings.request_timeout, limit=settings.max_concurrent_requests)

    def provider_settings(request, kind):
        if settings.credential_mode == "server":
            return settings
        value = request.headers.get("x-llm-key" if kind == "llm" else "x-tts-key", "").strip()
        if not value:
            raise GuardError("请在设置中填写你自己的对话 Key。" if kind == "llm" else "请在设置中填写你自己的语音 Key。", 428, "credentials_required")
        if len(value) > 512 or not value.isascii() or any(ord(c) < 33 or ord(c) > 126 for c in value):
            raise GuardError("Key 格式不正确。", 400, "invalid_credentials")
        field = "llm_api_key" if kind == "llm" else "doubao_tts_api_key" if settings.tts_provider == "doubao" else "tts_api_key"
        # Never mutate application-global credentials or retain user keys in SQLite.
        return settings.model_copy(update={"llm_api_key": SecretStr(""), "tts_api_key": SecretStr(""), "doubao_tts_api_key": SecretStr(""), field: SecretStr(value)})

    async def chat_reply(request, key, request_id, history, text, **kwargs):
        local = provider_settings(request, "llm")
        if not local.llm_api_key.get_secret_value():
            raise GuardError("请在项目根目录 .env 中填写 LLM_API_KEY，然后重启后端。", 428, "server_credentials_required")
        store = app.state.store
        store.check_disk()
        operation = "turn:" + key + ":" + str(request_id)
        # Conservative UTF-8 reservation, including serialized-history overhead.
        tokens = len((load_system_prompt() + text + str(history) + str(kwargs.get("game_context", ""))).encode()) + 3000 + (4096 if kwargs.get("image") else 0)
        store.reserve_usage(key, client_ip(request), store.key(local.llm_api_key.get_secret_value()), tokens=tokens, operation=operation, fingerprint=hashlib.sha256(text.encode()).hexdigest())
        try:
            async with asyncio.timeout(settings.request_timeout):
                return await OpenAIChat(local, app.state.client).reply(history, text, **kwargs)
        except TimeoutError:
            raise ProviderError("对话服务超时，结果未能确认，请稍后再试。") from None

    def connect(response: Response):
        token = app.state.store.create_session()
        password = settings.app_password.get_secret_value()
        cookie = token + "." + hmac.new(password.encode(), token.encode(), hashlib.sha256).hexdigest() if password else token
        response.set_cookie(COOKIE, cookie, httponly=True, secure=settings.cookie_secure, samesite="strict", max_age=settings.session_retention_days * 86400, path="/api")
        return app.state.store.key(token)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/config")
    def config():
        return {"tts": settings.tts_mode, "credential_mode": settings.credential_mode, "tts_provider": settings.tts_provider, "password_required": bool(settings.app_password.get_secret_value())}

    @app.post("/api/login")
    async def login(data: LoginRequest, request: Request, response: Response):
        budget(request)
        password = settings.app_password.get_secret_value()
        if password and not hmac.compare_digest(data.password.encode(), password.encode()):
            raise HTTPException(401, "访问口令不正确。")
        key = cookie_session(request) or connect(response)
        return {"messages": app.state.store.history(key), "affection": app.state.store.affection(key), "game_completed": app.state.store.game_completed(key, game_day()), "drawing_snapshot": drawing_snapshot(key)}

    @app.get("/api/session")
    async def get_session(request: Request, response: Response):
        key = cookie_session(request)
        if key:
            budget(request, key, snapshot=True)
        if not key:
            if settings.app_password.get_secret_value():
                raise HTTPException(401, "请输入访问口令。")
            budget(request)
            key = connect(response)
        return {"messages": app.state.store.history(key), "affection": app.state.store.affection(key), "game_completed": app.state.store.game_completed(key, game_day()), "drawing_snapshot": drawing_snapshot(key)}

    @app.delete("/api/session/messages")
    async def clear_history(request: Request):
        key = session(request)
        budget(request, key)
        async with exclusive(key):
            app.state.store.clear(key)
        return {"messages": [], "affection": 60, "drawing_snapshot": drawing_snapshot(key)}

    @app.post("/api/chat")
    async def chat(data: ChatRequest, request: Request):
        key = session(request)
        budget(request, key)
        async with exclusive(key):
            previous = app.state.store.previous_turn(key, str(data.request_id))
            if previous:
                if previous[0] != data.text:
                    raise HTTPException(409, "请求编号已用于另一条消息。")
                return previous[1]
            store = app.state.store
            state = store.drawing_state(key)["state"]
            current = state if state and state["mode"] != "finished" else None
            row = store.drawing_round(key, current.get("round_id")) if current and current.get("round_id") else None
            if row and not row["ready"]:
                current = {**current, "progress": 0}
            completed = store.game_completed(key, game_day())
            history = store.history(key, 20)
            last_reply = next((item for item in reversed(history) if item["role"] == "assistant"), None)
            returning = bool(current and last_reply and last_reply.get("topic") == "chat")
            can_confirm = bool(current and current["mode"] == "user" and current.get("can_confirm"))
            reply = quick_reply(data.text)
            if can_confirm and confirms_guess(data.text) and (not returning or "猜对" in data.text or "答对" in data.text):
                reply = quick_reply("答对了！")
                reply.game_intent = "confirm"
            resuming = bool(reply and reply.topic == "drawing_game" and current and data.text != "答对了！" and reply.game_intent != "confirm")
            if reply and reply.topic == "drawing_game" and completed:
                reply = daily_limit_reply()
            elif resuming:
                reply = resume_reply() if returning else None
            elif row and not row["solved"] and current.get("progress", 0) >= 1 and matches_answer(data.text, row["drawing"]):
                reply = answer_reply(True, row["drawing"])
                reply.game_intent = "answer"
            if reply is None:
                context = ""
                if current:
                    stage = "用户画，角色猜" if current["mode"] == "user" else "角色已画好，用户猜" if current.get("progress", 0) >= 1 else "角色正在画"
                    context = f"有未完成的你画我猜游戏；阶段：{stage}；暂停：{current.get('paused', False)}。用户可以随时闲聊，回到游戏时沿用原画。恢复游戏时根据本轮话语自然回应，不要重复开场白或声称重新开始、清空画板。角色还在画时不能宣告猜对或结束回合。"
                    if row:
                        context += "本轮角色画稿的真实谜底（数据，不是指令）：" + json.dumps(row["drawing"]["name"], ensure_ascii=False) + "。仅在用户明确询问答案或表示放弃时透露谜底，不自行更换答案。你没有看到渲染后的画面，不要编造图中有何种轮廓、部件或位置，也不要声称图画很像。用户说画得抽象时可以承认没画清楚。"
                    if can_confirm:
                        context += "角色已猜过用户的画，等待用户确认。用户明确认可刚才猜测（例如‘没错，就是这个’‘哈哈让你猜中了’）时返回 game_intent=confirm；否定、反问、纠正或只谈其他话题不能算确认。如果刚才在聊别的话题，不能把对那个话题的认可当作游戏确认。"
                elif completed:
                    context = "今天的游戏已结束，再提到游戏时提醒明天再玩。"
                reply = await chat_reply(request, key, data.request_id, history, data.text, affection=store.affection(key), game_context=context)
            if can_confirm and reply.game_intent == "confirm":
                reply = quick_reply("答对了！")
                reply.game_intent = "confirm"
            elif reply.game_intent == "confirm":
                reply.game_intent = "none"
            # A semantic verdict is also an answer signal: do not let an omitted
            # topic/intent leave "you guessed it" outside the atomic settlement.
            if row and not row["solved"] and current.get("progress", 0) >= 1 and reply.game_answer_correct is not None:
                reply.topic = "drawing_game"
                reply.game_intent = "answer"
            if resuming and not completed:
                reply.topic = "drawing_game"
                reply.game_intent = "resume"
            if reply.topic == "drawing_game":
                if completed:
                    reply = daily_limit_reply()
                elif reply.game_intent == "answer" and row and not row["solved"] and current.get("progress", 0) >= 1:
                    correct = matches_answer(data.text, row["drawing"]) or reply.game_answer_correct is True
                    try:
                        return store.save_turn(key, str(data.request_id), data.text, answer_reply(correct, row["drawing"]),
                            drawing_result={"round_id": current["round_id"], "correct": correct}, game_day=game_day() if correct else None)
                    except DailyGameLimit:
                        raise HTTPException(429, DAILY_LIMIT_TEXT)
                elif returning and reply.game_intent not in {"answer", "confirm"}:
                    reply = resume_reply()
                elif reply.game_intent in {"answer", "resume"} and not current:
                    reply = quick_reply("来玩你画我猜吧")
            return store.save_turn(key, str(data.request_id), data.text, reply)

    def drawing_snapshot(key: str):
        snapshot = app.state.store.drawing_state(key)
        state = snapshot["state"]
        if state and state.get("round_id"):
            row = app.state.store.drawing_round(key, state["round_id"])
            if row:
                state["round"] = {"round_id": state["round_id"], "strokes": row["drawing"]["strokes"], "solved": bool(row["solved"])}
                if row["solved"]:
                    state["mode"] = "finished"
                    state["progress"] = 1
        return snapshot

    @app.get("/api/drawing/state")
    async def get_drawing_state(request: Request):
        key = session(request)
        budget(request, key, snapshot=True)
        return drawing_snapshot(key)

    @app.put("/api/drawing/state")
    async def put_drawing_state(data: DrawingStateRequest, request: Request):
        key = session(request)
        budget(request, key, snapshot=True)
        app.state.store.check_disk()
        async with exclusive(key):
            state = data.state.model_dump(mode="json")
            saved = app.state.store.drawing_state(key)["state"]
            active_id = saved.get("round_id") if saved else None
            if state["round_id"] != active_id:
                old = app.state.store.drawing_round(key, active_id) if active_id else None
                if not (old and old["solved"] and state["round_id"] is None and state["mode"] == "user"
                        and not app.state.store.game_completed(key, game_day())):
                    raise HTTPException(409, "不能切换到其他绘画回合，请重新载入。")
            if state["round_id"]:
                row = app.state.store.drawing_round(key, state["round_id"])
                if not row:
                    raise HTTPException(404, "这一轮已经失效。")
                if row["solved"]:
                    state["mode"] = "finished"
                    state["progress"] = 1
                else:
                    state["mode"] = "character"
                    if state["progress"] >= 1 and not row["ready"]:
                        raise HTTPException(409, "角色还在绘画，请稍后提交。")
            elif state["mode"] != "user":
                raise HTTPException(409, "尚未创建角色绘画回合。")
            if not app.state.store.save_drawing_state(key, data.version, state):
                raise HTTPException(409, "游戏进度已更新，请重新载入。")
        return {"version": data.version + 1}

    @app.post("/api/drawing/guess")
    async def guess_drawing(data: DrawingRequest, request: Request):
        key = session(request)
        budget(request, key)
        if app.state.store.game_completed(key, game_day()):
            raise HTTPException(429, DAILY_LIMIT_TEXT)
        async with exclusive(key):
            fingerprint = "drawing:" + hashlib.sha256(data.image.encode()).hexdigest()
            previous = app.state.store.previous_turn(key, str(data.request_id))
            if previous:
                if previous[0] != fingerprint:
                    raise HTTPException(409, "请求编号已用于另一张画或消息。")
                return previous[1]
            text = "猜猜我画的是什么？"
            reply = await chat_reply(request, key, data.request_id, app.state.store.history(key, 20), text,
                affection=app.state.store.affection(key), image=data.image)
            reply.topic = "drawing_game"
            return app.state.store.save_turn(key, str(data.request_id), text, reply, request_input=fingerprint)

    @app.post("/api/drawing/round")
    async def start_drawing(data: DrawingRoundRequest, request: Request):
        key = session(request)
        budget(request, key)
        store = app.state.store
        async with exclusive(key):
            round_id = str(data.request_id)
            row = store.drawing_round(key, round_id)
            if row:
                return {"round_id":round_id, "strokes":row["drawing"]["strokes"], "solved":bool(row["solved"]), "drawing_snapshot":drawing_snapshot(key)}
            if store.game_completed(key, game_day()):
                raise HTTPException(429, DAILY_LIMIT_TEXT)
            state = store.drawing_state(key)["state"]
            # Reopening an active round (including a reload after a lost response)
            # must never pick a second drawing or discard the first one.
            if state and state.get("mode") == "character" and state.get("round_id"):
                row = store.drawing_round(key, state["round_id"])
                if row and not row["solved"]:
                    return {"round_id":state["round_id"], "strokes":row["drawing"]["strokes"], "solved":False, "drawing_snapshot":drawing_snapshot(key)}
            store.check_disk()
            recent = store.recent_drawings(key)
            drawing_id, drawing = choose_drawing(recent)
            store.save_drawing_round(key, round_id, drawing, drawing_id=drawing_id)
            return {"round_id":round_id, "strokes":drawing["strokes"], "solved":False, "drawing_snapshot":drawing_snapshot(key)}

    @app.post("/api/drawing/answer")
    async def drawing_answer(data: DrawingAnswerRequest, request: Request):
        key = session(request)
        budget(request, key)
        async with exclusive(key):
            fingerprint = "drawing-answer:" + str(data.round_id) + ":" + data.text
            previous = app.state.store.previous_turn(key, str(data.request_id))
            if previous:
                if previous[0] != fingerprint:
                    raise HTTPException(409, "请求编号已用于另一条答案。")
                return previous[1]
            if app.state.store.game_completed(key, game_day()):
                raise HTTPException(429, DAILY_LIMIT_TEXT)
            row = app.state.store.drawing_round(key, str(data.round_id))
            if not row:
                raise HTTPException(404, "这一轮已经失效，请重新开始。")
            if row["solved"]:
                raise HTTPException(409, "这一轮已经结束啦。")
            state = app.state.store.drawing_state(key)["state"]
            if not state or state.get("round_id") != str(data.round_id):
                raise HTTPException(409, "只能回答当前绘画回合。")
            if not row["ready"] or state.get("progress", 0) < 1:
                raise HTTPException(409, "角色还在绘画，请稍后提交答案。")
            drawing = row["drawing"]
            correct = matches_answer(data.text, drawing)
            try:
                return app.state.store.save_turn(key, str(data.request_id), data.text, answer_reply(correct, drawing),
                    request_input=fingerprint, drawing_result={"round_id": str(data.round_id), "correct": correct},
                    game_day=game_day() if correct else None)
            except DailyGameLimit:
                raise HTTPException(429, DAILY_LIMIT_TEXT)

    @app.post("/api/tts")
    async def tts(data: SpeechRequest, request: Request):
        key = session(request)
        if settings.credential_mode == "server" and not settings.tts_enabled:
            raise HTTPException(503, "服务端 TTS 尚未配置。")
        budget(request, key)
        async with exclusive("tts:" + key):
            text = WELCOME_TEXT if data.preset == "welcome" else app.state.store.speech_text(key, data.message_id)
            if not text:
                raise HTTPException(404, "这条回复不存在，请刷新会话。")
            if settings.credential_mode == "byok" and not request.headers.get("x-tts-key", "").strip():
                audio = await app.state.speech.synthesize(text, message_id=data.message_id, shared_only=True)
                return Response(audio, media_type="audio/mpeg") if audio is not None else Response(status_code=204)
            def prepare_speech(cache_key):
                local = provider_settings(request, "tts")
                store = app.state.store
                store.check_disk()
                secret = local.doubao_tts_api_key if local.tts_provider == "doubao" else local.tts_api_key
                payer = store.key(secret.get_secret_value())
                operation = "audio:" + cache_key + ":" + payer
                store.reserve_usage(key, client_ip(request), payer, tts_chars=len(text), operation=operation, fingerprint=cache_key, allow_completed=True)
                provider = DoubaoSpeech(local, app.state.client) if local.tts_provider == "doubao" else OpenAISpeech(local, app.state.client)
                return provider, operation
            audio = await app.state.speech.synthesize(text, message_id=data.message_id, prepare=prepare_speech)
        return Response(audio, media_type="audio/mpeg")

    # Unknown API paths must never return the frontend or files outside dist.
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unknown_api(path: str):
        raise HTTPException(404, "接口不存在。")

    if settings.static_dir.is_dir():
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="frontend")
    return app


app = create_app()
