"""LiteLlmClient: the LiteLLM call, error translation and response checks (no network)."""

import logging
from types import SimpleNamespace
from typing import Any

import litellm
import pytest
from pydantic import BaseModel

from app.llm import LiteLlmClient, LlmError, model_name

MODEL = "openai/gpt-4.1-mini"


class Turn(BaseModel):
    reply: str


def fake_response(content: str | None, *, finish_reason: str = "stop", refusal: str | None = None) -> Any:
    message = SimpleNamespace(content=content, refusal=refusal)
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=finish_reason)])


@pytest.fixture(autouse=True)
def api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-key")
    monkeypatch.delenv("OPENAI_MODEL", raising=False)


def client(completion_fn) -> LiteLlmClient:
    return LiteLlmClient(timeout=20, max_retries=1, completion_fn=completion_fn)


def test_calls_litellm_with_structured_output_timeout_and_retries() -> None:
    calls: list[dict] = []

    def completion(**kwargs):
        calls.append(kwargs)
        return fake_response('{"reply": "hi"}')

    assert client(completion).complete([{"role": "user", "content": "hello"}], Turn) == Turn(reply="hi")
    (kwargs,) = calls
    assert kwargs["model"] == MODEL
    assert kwargs["response_format"] is Turn
    assert kwargs["timeout"] == 20
    assert kwargs["max_retries"] == 1
    assert kwargs["messages"] == [{"role": "user", "content": "hello"}]
    assert "api_key" not in kwargs  # LiteLLM reads OPENAI_API_KEY from the environment


def test_model_comes_from_openai_model(monkeypatch: pytest.MonkeyPatch) -> None:
    assert model_name() == MODEL
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4.1")
    assert model_name() == "openai/gpt-4.1"


def test_real_litellm_completion_with_mock_response() -> None:
    """Goes through litellm.completion itself (response_format handling included), offline."""

    def completion(**kwargs):
        return litellm.completion(**kwargs, mock_response='{"reply": "from litellm"}')

    assert client(completion).complete([{"role": "user", "content": "hi"}], Turn).reply == "from litellm"


def test_missing_api_key_is_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY")
    with pytest.raises(LlmError) as err:
        client(lambda **_: pytest.fail("must not call the LLM")).complete([], Turn)
    assert (err.value.status, err.value.code, err.value.retryable) == (503, "llm_not_configured", False)


def _err(cls, **extra):
    return cls(message="boom", llm_provider="openai", model=MODEL, **extra)


@pytest.mark.parametrize(
    ("exc", "status", "code", "retryable"),
    [
        (_err(litellm.Timeout), 504, "llm_timeout", True),
        (_err(litellm.RateLimitError), 429, "llm_rate_limited", True),
        (_err(litellm.AuthenticationError), 503, "llm_not_configured", False),
        (_err(litellm.NotFoundError), 503, "llm_not_configured", False),
        (_err(litellm.BadRequestError), 422, "llm_rejected", False),
        (_err(litellm.ContextWindowExceededError), 422, "llm_rejected", False),
        (_err(litellm.APIConnectionError), 502, "llm_unavailable", True),
        (_err(litellm.ServiceUnavailableError), 502, "llm_unavailable", True),
        (_err(litellm.InternalServerError), 502, "llm_unavailable", True),
        (RuntimeError("unexpected"), 502, "llm_unavailable", True),
    ],
)
def test_translates_provider_errors(exc: Exception, status: int, code: str, retryable: bool) -> None:
    def completion(**_):
        raise exc

    with pytest.raises(LlmError) as err:
        client(completion).complete([], Turn)
    assert (err.value.status, err.value.code, err.value.retryable) == (status, code, retryable)
    assert err.value.message


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (fake_response(None), "llm_bad_response"),
        (fake_response(""), "llm_bad_response"),
        (fake_response('{"reply": "cut'), "llm_bad_response"),
        (fake_response('{"reply": "hi"}', finish_reason="length"), "llm_bad_response"),
        (fake_response('{"other": 1}'), "llm_bad_response"),
        (fake_response(None, refusal="I can't help with that"), "llm_refused"),
    ],
)
def test_rejects_unusable_responses(response: Any, code: str) -> None:
    with pytest.raises(LlmError) as err:
        client(lambda **_: response).complete([], Turn)
    assert err.value.code == code


def test_logs_never_contain_the_key_or_conversation(caplog: pytest.LogCaptureFixture) -> None:
    def completion(**_):
        raise _err(litellm.AuthenticationError)

    caplog.set_level(logging.DEBUG)
    with pytest.raises(LlmError):
        client(completion).complete([{"role": "user", "content": "my secret address"}], Turn)
    assert "AuthenticationError" in caplog.text
    assert "sk-test" not in caplog.text and "secret address" not in caplog.text


def test_per_call_timeout_overrides_the_default() -> None:
    calls: list[dict] = []

    def completion(**kwargs):
        calls.append(kwargs)
        return fake_response('{"reply": "hi"}')

    llm = client(completion)
    llm.complete([], Turn, timeout=7.5)
    llm.complete([], Turn)
    assert [c["timeout"] for c in calls] == [7.5, 20]


def test_per_call_retries_override_the_default() -> None:
    calls: list[dict] = []

    def completion(**kwargs):
        calls.append(kwargs)
        return fake_response('{"reply": "hi"}')

    llm = client(completion)
    llm.complete([], Turn, max_retries=0)
    llm.complete([], Turn)
    assert [c["max_retries"] for c in calls] == [0, 1]


def test_litellm_is_not_imported_with_the_app() -> None:
    """The import takes most of a cold start on a small instance: the app must start without it."""
    import subprocess
    import sys

    code = "import sys, app.main; sys.exit(1 if 'litellm' in sys.modules else 0)"
    assert subprocess.run([sys.executable, "-c", code], check=False).returncode == 0


def test_preload_loads_litellm_in_the_background() -> None:
    from app.llm import load_litellm, preload_litellm

    thread = preload_litellm()
    assert thread.daemon
    thread.join(timeout=120)
    assert load_litellm() is litellm
