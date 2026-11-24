"""PreLegal backend: the V1 API plus the frontend's static export, at http://localhost:8000.

Run with `uvicorn app.main:create_app --factory`.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import db
from .api import router as api_router
from .config import Settings
from .llm import LiteLlmClient, StructuredLlm
from .templates import load_catalog

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, llm: StructuredLlm | None = None) -> FastAPI:
    """Builds the app. `llm` defaults to LiteLLM -> OpenAI; tests pass a fake."""
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
    app.include_router(api_router)

    # Mounted last: "/" matches every path, so routes registered after it would be unreachable.
    # html=True serves route/index.html (Next.js trailingSlash export) and 404.html for misses.
    static_dir = settings.static_dir
    if static_dir is not None and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
    else:
        logger.warning("No frontend build found at %s; serving the API only", static_dir)
    return app
