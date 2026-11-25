"""Structured-output LLM calls through LiteLLM, pointed at the OpenAI API (see the cerebras skill).

This is the only module that imports litellm. It translates every provider failure into an
LlmError carrying the HTTP status, a stable code and a user-facing message.

litellm is imported on first use, not with this module: the import takes most of a cold start on a
small instance (about 50 s at 0.1 CPU), so the app starts answering first and `preload_litellm`
loads it in the background.
"""

import logging
import os
import threading
from collections.abc import Callable
from types import ModuleType
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

# Use LiteLLM's bundled model cost map instead of fetching it from GitHub at import time.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

logger = logging.getLogger(__name__)

_litellm: ModuleType | None = None
_litellm_lock = threading.Lock()


def load_litellm() -> ModuleType:
    """The litellm module, imported and configured once (thread-safe)."""
    global _litellm
    with _litellm_lock:
        if _litellm is None:
            import litellm

            # Conversations contain names and addresses: keep them out of LiteLLM's logs and
            # exception text.
            litellm.suppress_debug_info = True
            litellm.turn_off_message_logging = True
            litellm.redact_messages_in_exceptions = True
            _litellm = litellm
    return _litellm


def preload_litellm() -> threading.Thread:
    """Starts importing litellm in a background thread, so the first chat turn needn't wait."""
    thread = threading.Thread(target=load_litellm, name="litellm-preload", daemon=True)
    thread.start()
    return thread


T = TypeVar("T", bound=BaseModel)


def model_name() -> str:
    """The LiteLLM model id, read at call time so OPENAI_MODEL changes take effect."""
    return f"openai/{os.getenv('OPENAI_MODEL', 'gpt-4.1-mini')}"


class LlmError(Exception):
    """An LLM failure, mapped to an HTTP status and a JSON error envelope for the frontend."""

    def __init__(self, status: int, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.retryable = retryable

    def detail(self) -> dict[str, Any]:
        return error_detail(self.code, self.message, retryable=self.retryable)


def error_detail(code: str, message: str, *, retryable: bool) -> dict[str, Any]:
    """The coded error envelope the frontend understands: {"code", "message", "retryable"}."""
    return {"code": code, "message": message, "retryable": retryable}


def _not_configured() -> LlmError:
    return LlmError(503, "llm_not_configured", "The AI assistant is not configured.", retryable=False)


def _bad_response() -> LlmError:
    return LlmError(
        502, "llm_bad_response", "The AI assistant gave an unusable answer. Try again.", retryable=True
    )


def translate_error(exc: Exception) -> LlmError:
    """Maps a LiteLLM / OpenAI exception to an LlmError (subclasses are checked first)."""
    litellm = load_litellm()
    if isinstance(exc, litellm.Timeout):
        return LlmError(
            504, "llm_timeout", "The AI assistant took too long to answer. Try again.", retryable=True
        )
    if isinstance(exc, litellm.RateLimitError):
        return LlmError(
            429, "llm_rate_limited", "The AI assistant is busy. Try again in a moment.", retryable=True
        )
    if isinstance(exc, litellm.AuthenticationError | litellm.PermissionDeniedError | litellm.NotFoundError):
        return _not_configured()
    if isinstance(exc, litellm.BadRequestError):  # includes context-window and content-policy errors
        return LlmError(
            422,
            "llm_rejected",
            "The AI assistant could not process this conversation. Start over to try again.",
            retryable=False,
        )
    return LlmError(
        502, "llm_unavailable", "The AI assistant is temporarily unavailable. Try again.", retryable=True
    )


class StructuredLlm(Protocol):
    def prepare(self) -> None:
        """Blocks until the client can make calls (LiteLLM: until it has been imported)."""
        ...

    def complete(
        self,
        messages: list[dict[str, str]],
        response_model: type[T],
        *,
        timeout: float | None = None,
        max_retries: int | None = None,
    ) -> T:
        """`timeout` (seconds, per attempt) and `max_retries` override the client's defaults."""
        ...


class LiteLlmClient:
    """Calls OpenAI through LiteLLM with a Structured Outputs response_format (a Pydantic model)."""

    def __init__(
        self, *, timeout: float, max_retries: int, completion_fn: Callable[..., Any] | None = None
    ) -> None:
        self._timeout = timeout
        self._max_retries = max_retries
        self._completion = completion_fn

    def prepare(self) -> None:
        # After a cold start the background import (preload_litellm) may still be running: wait
        # for it here, before the chat's time budget starts, so loading never eats into the AI's time.
        if self._completion is None:
            load_litellm()

    def complete(
        self,
        messages: list[dict[str, str]],
        response_model: type[T],
        *,
        timeout: float | None = None,
        max_retries: int | None = None,
    ) -> T:
        if not os.getenv("OPENAI_API_KEY"):
            raise _not_configured()
        completion = self._completion or load_litellm().completion
        try:
            response = completion(
                model=model_name(),
                messages=messages,
                response_format=response_model,
                timeout=self._timeout if timeout is None else timeout,
                # Retries happen in the OpenAI client (backoff included); LiteLLM's num_retries is
                # left unset so the two layers don't multiply.
                max_retries=self._max_retries if max_retries is None else max_retries,
                temperature=0.2,
            )
        except Exception as exc:
            # Only the class name: exception text may echo request details.
            logger.warning("LLM call failed: %s", type(exc).__name__)
            raise translate_error(exc) from None

        choice = response.choices[0]
        message = choice.message
        if getattr(message, "refusal", None):
            logger.warning("LLM refused to answer")
            raise LlmError(
                422, "llm_refused", "The AI assistant declined to answer. Try rephrasing.", retryable=False
            )
        if choice.finish_reason == "length" or not message.content:
            logger.warning("LLM response incomplete (finish_reason=%s)", choice.finish_reason)
            raise _bad_response()
        try:
            return response_model.model_validate_json(message.content)
        except ValidationError:
            logger.warning("LLM response did not match the schema")
            raise _bad_response() from None
