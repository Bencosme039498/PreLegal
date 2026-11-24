"""FastAPI dependencies shared by the API routers (everything comes from app.state, set by create_app)."""

import sqlite3
from collections.abc import Callable, Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from . import db
from .config import Settings
from .llm import StructuredLlm, error_detail
from .ratelimit import RateLimiter
from .templates import TemplateDef


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_db(settings: SettingsDep) -> Iterator[sqlite3.Connection]:
    with db.connect(settings.db_path) as conn:
        yield conn


# Cached per request: the auth dependency and the endpoint share one connection (one transaction).
# scope="function" commits (or rolls back) before the response is sent; the default "request" scope
# would commit afterwards, so the client's next request could miss what it was just told was saved
# (e.g. a new session cookie answered with 401).
DbConn = Annotated[sqlite3.Connection, Depends(get_db, scope="function")]


def get_catalog(request: Request) -> dict[str, TemplateDef]:
    return request.app.state.catalog


Catalog = Annotated[dict[str, TemplateDef], Depends(get_catalog)]


def get_llm(request: Request) -> StructuredLlm:
    return request.app.state.llm


def get_clock(request: Request) -> Callable[[], float]:
    """Unix time; tests inject a fake clock through create_app."""
    return request.app.state.clock


Clock = Annotated[Callable[[], float], Depends(get_clock)]


def get_chat_limiter(request: Request) -> RateLimiter:
    return request.app.state.chat_limiter


def get_auth_limiter(request: Request) -> RateLimiter:
    return request.app.state.auth_limiter


ChatLimiter = Annotated[RateLimiter, Depends(get_chat_limiter)]
AuthLimiter = Annotated[RateLimiter, Depends(get_auth_limiter)]


def api_error(
    status: int, code: str, message: str, *, retryable: bool = False, headers: dict[str, str] | None = None
) -> HTTPException:
    """An HTTP error with the coded envelope {"detail": {"code", "message", "retryable"}}."""
    return HTTPException(status, detail=error_detail(code, message, retryable=retryable), headers=headers)


def unknown_template(message: str = "This document type doesn't exist.") -> HTTPException:
    return api_error(404, "unknown_template", message)
