"""PreLegal backend: the V1 API plus the frontend's static export, at http://localhost:8000.

Run with `uvicorn app.main:create_app --factory`.
"""

import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import api, auth, db, documents
from .config import Settings
from .llm import LiteLlmClient, StructuredLlm
from .ratelimit import RateLimiter
from .templates import load_catalog

logger = logging.getLogger(__name__)


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
        db.reset_database(settings.db_path)
        yield

    app = FastAPI(
        title="PreLegal",
        lifespan=lifespan,
        # Keep everything the backend owns under /api, so it never collides with frontend routes.
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
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
