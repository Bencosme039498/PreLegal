import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from . import chat, db
from .config import Settings
from .llm import LlmError, StructuredLlm, error_detail
from .schemas import ChatRequest, ChatResponse, Health, SessionRequest, UserOut
from .templates import TemplateDef

router = APIRouter(prefix="/api")


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(settings: Annotated[Settings, Depends(get_settings)]) -> Iterator[sqlite3.Connection]:
    with db.connect(settings.db_path) as conn:
        yield conn


DbConn = Annotated[sqlite3.Connection, Depends(get_db)]


def get_catalog(request: Request) -> dict[str, TemplateDef]:
    return request.app.state.catalog


def get_llm(request: Request) -> StructuredLlm:
    return request.app.state.llm


@router.get("/health")
def health() -> Health:
    return Health(status="ok")


@router.post("/session")
def create_session(body: SessionRequest, conn: DbConn) -> UserOut:
    """Fake sign-in: records the user (by email) and returns them. No authentication."""
    return UserOut.model_validate(dict(db.upsert_user(conn, name=body.name, email=body.email)))


@router.post("/chat")
def chat_turn(
    body: ChatRequest,
    catalog: Annotated[dict[str, TemplateDef], Depends(get_catalog)],
    llm: Annotated[StructuredLlm, Depends(get_llm)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ChatResponse:
    """AI chat that picks a document (no template_id) and fills in its fields. Stateless: the
    client sends the whole conversation; the response's template_id says which document it is now about.

    Errors use the envelope {"detail": {"code", "message", "retryable"}}; the frontend shows the
    message in the chat (and offers Retry when retryable) instead of treating it as "no backend".
    """
    if body.template_id is not None and body.template_id not in catalog:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "unknown_template", "The AI assistant can't draft this document.", retryable=False
            ),
        )
    budget = chat.Budget(
        total_s=settings.chat_budget_s,
        attempt_cap_s=settings.llm_timeout_s,
        attempts=settings.llm_max_retries + 1,
    )
    try:
        return chat.run_chat(llm, catalog, body.template_id, body.messages, body.values, budget)
    except LlmError as e:
        raise HTTPException(status_code=e.status, detail=e.detail()) from None


# Registered last: unknown /api/* paths get a JSON 404 instead of the frontend's HTML 404 page.
@router.api_route(
    "/{_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
def api_not_found(_path: str) -> None:
    raise HTTPException(status_code=404, detail="Not found")
