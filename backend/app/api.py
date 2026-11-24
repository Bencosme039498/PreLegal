"""The core API: health and the AI chat. Accounts are in auth.py, saved documents in documents.py."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from . import chat
from .auth import CurrentUser
from .deps import Catalog, ChatLimiter, SettingsDep, api_error, get_llm, unknown_template
from .llm import LlmError, StructuredLlm
from .ratelimit import retry_after_header
from .schemas import ChatRequest, ChatResponse, Health

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> Health:
    return Health(status="ok")


@router.post("/chat")
def chat_turn(
    body: ChatRequest,
    user: CurrentUser,
    catalog: Catalog,
    llm: Annotated[StructuredLlm, Depends(get_llm)],
    settings: SettingsDep,
    limiter: ChatLimiter,
) -> ChatResponse:
    """AI chat that picks a document (no template_id) and fills in its fields. Stateless: the
    client sends the whole conversation; the response's template_id says which document it is now about.
    Needs a signed-in user, and each user may send settings.chat_rate_limit turns per window.

    Errors use the envelope {"detail": {"code", "message", "retryable"}}; the frontend shows the
    message in the chat (and offers Retry when retryable) instead of treating it as "no backend".
    """
    if body.template_id is not None and body.template_id not in catalog:
        raise unknown_template("The AI assistant can't draft this document.")
    wait = limiter.hit(f"user:{user['id']}")
    if wait is not None:
        raise api_error(
            429,
            "chat_rate_limited",
            "You're sending messages faster than the assistant allows. Wait a moment and try again.",
            retryable=True,
            headers=retry_after_header(wait),
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


# Included last (see main.py): unknown /api/* paths get a JSON 404 instead of the frontend's HTML 404 page.
fallback = APIRouter(prefix="/api", include_in_schema=False)


@fallback.api_route("/{_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_not_found(_path: str) -> None:
    raise HTTPException(status_code=404, detail="Not found")
