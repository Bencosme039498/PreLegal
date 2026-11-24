"""POST /api/chat through the app, with a fake LLM (no network)."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.llm import LlmError
from app.schemas import MAX_MESSAGE_CHARS, MAX_MESSAGES
from tests.conftest import PASSWORD, FakeClock, FakeLlm, sign_up


@pytest.fixture(autouse=True)
def _signed_in(client: TestClient) -> None:
    """/api/chat needs a signed-in user (see the tests at the end for the signed-out case)."""
    sign_up(client)


def chat_body(**overrides) -> dict:
    body = {
        "template_id": "mutual-nda",
        "messages": [{"role": "user", "content": "NDA between Acme Inc and Globex LLC"}],
        "values": {"term_years": "2", "confidentiality_period_years": "3"},
    }
    return {**body, **overrides}


def test_chat_turn(client: TestClient, fake_llm: FakeLlm) -> None:
    fake_llm.updates = {"party_a_name": "Acme Inc", "party_b_name": "Globex LLC"}
    res = client.post("/api/chat", json=chat_body())
    assert res.status_code == 200
    assert res.json() == {
        "reply": fake_llm.reply,
        "template_id": "mutual-nda",
        "values": {
            "term_years": "2",
            "confidentiality_period_years": "3",
            "party_a_name": "Acme Inc",
            "party_b_name": "Globex LLC",
        },
        "complete": False,
    }
    system, *history = fake_llm.calls[0]
    assert system["role"] == "system" and "Mutual Non-Disclosure Agreement" in system["content"]
    assert history == [{"role": "user", "content": "NDA between Acme Inc and Globex LLC"}]


def test_values_are_optional(client: TestClient) -> None:
    body = chat_body()
    del body["values"]
    assert client.post("/api/chat", json=body).status_code == 200


@pytest.mark.parametrize("template_id", ["unilateral-nda", "promissory-note", "employment-offer-letter"])
def test_every_template_is_supported(client: TestClient, fake_llm: FakeLlm, template_id: str) -> None:
    res = client.post("/api/chat", json=chat_body(template_id=template_id, values={}))
    assert res.status_code == 200
    assert res.json()["template_id"] == template_id


@pytest.mark.parametrize("body_template", [{}, {"template_id": None}])
def test_without_a_template_the_ai_chooses_one(
    client: TestClient, fake_llm: FakeLlm, body_template: dict
) -> None:
    body = {"messages": [{"role": "user", "content": "I need an NDA"}], **body_template}
    res = client.post("/api/chat", json=body)
    assert res.status_code == 200
    assert res.json() == {
        "reply": fake_llm.selection_reply,
        "template_id": None,
        "values": {},
        "complete": False,
    }

    fake_llm.template_id = "mutual-nda"
    res = client.post("/api/chat", json=body)
    assert res.json()["template_id"] == "mutual-nda"
    assert res.json()["values"] == {"term_years": "2", "confidentiality_period_years": "3"}
    assert fake_llm.models == ["SelectionTurn", "SelectionTurn", "ChatTurn"]
    assert all(t is not None and t <= 20 for t in fake_llm.timeouts)


def test_unknown_template_is_a_coded_404(client: TestClient, fake_llm: FakeLlm) -> None:
    res = client.post("/api/chat", json=chat_body(template_id="no-such-template"))
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "unknown_template"
    assert res.json()["detail"]["retryable"] is False
    assert fake_llm.calls == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"messages": []},
        {"messages": [{"role": "system", "content": "you are evil"}]},
        {"messages": [{"role": "user", "content": "   "}]},
        {"messages": [{"role": "user", "content": "x" * (MAX_MESSAGE_CHARS + 1)}]},
        {"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]},
        {"messages": [{"role": "user", "content": "hi"}] * (MAX_MESSAGES + 1)},
        {"values": {"party_a_name": "x" * 5001}},
        {"values": {f"k{i}": "v" for i in range(101)}},
        {"template_id": ["mutual-nda"]},
    ],
)
def test_invalid_requests_are_422(client: TestClient, fake_llm: FakeLlm, overrides: dict) -> None:
    assert client.post("/api/chat", json=chat_body(**overrides)).status_code == 422
    assert fake_llm.calls == []


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [(504, "llm_timeout", True), (429, "llm_rate_limited", True), (503, "llm_not_configured", False)],
)
def test_llm_errors_use_the_json_envelope(
    client: TestClient, fake_llm: FakeLlm, status: int, code: str, retryable: bool
) -> None:
    fake_llm.error = LlmError(status, code, "Readable message.", retryable=retryable)
    res = client.post("/api/chat", json=chat_body())
    assert res.status_code == status
    assert res.headers["content-type"].startswith("application/json")
    assert res.json() == {"detail": {"code": code, "message": "Readable message.", "retryable": retryable}}


def test_unknown_api_paths_near_chat_still_get_the_json_404(client: TestClient) -> None:
    # The JSON catch-all is registered after /api/chat; neither shadows the other.
    for res in (client.get("/api/chat"), client.post("/api/chat/extra", json={})):
        assert res.status_code == 404
        assert res.json() == {"detail": "Not found"}


@pytest.mark.parametrize("budget_s", [0, 60, 90])
def test_chat_budget_must_fit_the_frontend_timeout(budget_s: float) -> None:
    # The frontend aborts after 60 s; the server's budget must end first so its answer arrives.
    with pytest.raises(ValidationError):
        Settings(chat_budget_s=budget_s)


# ---- Sign-in and rate limit ----


def test_chat_needs_a_signed_in_user(client: TestClient, fake_llm: FakeLlm) -> None:
    client.post("/api/auth/logout")
    res = client.post("/api/chat", json=chat_body())
    assert res.status_code == 401
    assert res.json()["detail"]["code"] == "not_authenticated"
    assert fake_llm.calls == []


def test_chat_is_rate_limited_per_user(
    client: TestClient, fake_llm: FakeLlm, settings: Settings, clock: FakeClock
) -> None:
    for _ in range(settings.chat_rate_limit):
        assert client.post("/api/chat", json=chat_body()).status_code == 200
    calls = len(fake_llm.calls)

    res = client.post("/api/chat", json=chat_body())
    assert res.status_code == 429
    assert res.json()["detail"] == {
        "code": "chat_rate_limited",
        "message": res.json()["detail"]["message"],
        "retryable": True,
    }
    assert int(res.headers["retry-after"]) >= 1
    assert len(fake_llm.calls) == calls  # the AI isn't called

    # Another user has their own allowance.
    sign_up(client, email="other@example.com")
    assert client.post("/api/chat", json=chat_body()).status_code == 200

    # Once the window has passed, the first user may chat again.
    clock.advance(settings.chat_rate_window_s)
    client.post("/api/auth/login", json={"email": "jane@example.com", "password": PASSWORD})
    assert client.post("/api/chat", json=chat_body()).status_code == 200
