import asyncio
import secrets
import time
from contextlib import asynccontextmanager


class GuardError(Exception):
    def __init__(self, detail, status=429, code="limit_exceeded"):
        self.detail, self.status, self.code = detail, status, code
        super().__init__(detail)


@asynccontextmanager
async def lease(store, name, *, timeout, limit=None):
    """SQLite-coordinated ownership for processes sharing one local database.

    Provider work has a separate hard deadline shorter than this lease. A
    crashed owner expires, but its paid-operation marker still blocks replay.
    """
    owner = secrets.token_hex(16)
    deadline = time.monotonic() + timeout + 5
    while True:
        result = store.acquire_lease(name, owner, timeout * 2 + 60, limit)
        if result == "acquired":
            break
        if result == "full":
            raise GuardError("服务繁忙，请稍后重试。")
        if time.monotonic() >= deadline:
            raise GuardError("这条请求仍在处理，请稍后重试。", 409, "request_processing")
        await asyncio.sleep(.05)
    try:
        yield
    finally:
        store.release_lease(name, owner)
