"""PreLegal backend: the V1 API plus the frontend's static export, at http://localhost:8000.

Run with `uvicorn app.main:create_app --factory`.
"""

import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import api, auth, db, documents
from .config import Settings
from .llm import LiteLlmClient, StructuredLlm
from .ratelimit import RateLimiter
from .templates import load_catalog

logger = logging.getLogger(__name__)


class ApiPathMiddleware:
    """Two adjustments for every /api/* request, needed behind the Vercel rewrite.

    - Accepts a trailing slash (/api/health/ is /api/health). The Next.js export uses
      trailingSlash: true, so Vercel may redirect /api/x to /api/x/ before proxying it here, and a
      FastAPI slash redirect would point the browser at this server's own host instead.
    - Marks API responses `Cache-Control: no-store`, so no CDN in front (Vercel caches external
      rewrites when headers allow it) ever stores a user's session or documents.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "") if scope["type"] == "http" else ""
        if not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return
        if len(path) > len("/api/") and path.endswith("/"):
            scope = {**scope, "path": path.rstrip("/")}
            if scope.get("raw_path"):
                scope["raw_path"] = scope["raw_path"].rstrip(b"/")

        async def send_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
                message = {**message, "headers": [*headers, (b"cache-control", b"no-store")]}
            await send(message)

        await self.app(scope, receive, send_no_store)


def create_app(
    settings: Settings | None = None,
    llm: StructuredLlm | None = None,
    clock: Callable[[], float] = time.time,
) -> FastAPI:
    """Builds the app. `llm` defaults to LiteLLM -> OpenAI; tests pass a fake (and may pass a fake
    `clock`, the Unix time used for session expiry and rate limits)."""
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        db.init_database(settings.db_path, reset=settings.db_reset)
        if settings.db_reset:
            logger.warning(
                "PRELEGAL_DB_RESET is on: the database at %s was recreated empty", settings.db_path
            )
        yield

    app = FastAPI(
        title="PreLegal",
        lifespan=lifespan,
        # Keep everything the backend owns under /api, so it never collides with frontend routes.
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(ApiPathMiddleware)
    app.state.settings = settings
    app.state.catalog = load_catalog(settings.templates_dir)  # fails fast if the dataset is missing
    app.state.llm = llm or LiteLlmClient(timeout=settings.llm_timeout_s, max_retries=settings.llm_max_retries)
    app.state.clock = clock
    app.state.chat_limiter = RateLimiter(settings.chat_rate_limit, settings.chat_rate_window_s, clock)
    app.state.auth_limiter = RateLimiter(settings.auth_rate_limit, settings.auth_rate_window_s, clock)
    app.include_router(auth.router)
    app.include_router(documents.router)
    app.include_router(api.router)
    app.include_router(api.fallback)  # last of the API: it matches every /api/* path

    # Mounted last: "/" matches every path, so routes registered after it would be unreachable.
    # html=True serves route/index.html (Next.js trailingSlash export) and 404.html for misses.
    static_dir = settings.static_dir
    if static_dir is not None and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
    else:
        logger.warning("No frontend build found at %s; serving the API only", static_dir)
    return app
