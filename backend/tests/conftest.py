import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.config import Settings
from app.llm import LlmError
from app.main import create_app

# A miniature Next.js static export (trailingSlash: true layout).
FAKE_EXPORT = {
    "index.html": "<h1>home</h1>",
    "login/index.html": "<h1>login</h1>",
    "templates/mutual-nda/index.html": "<h1>mutual nda</h1>",
    "404.html": "<h1>custom not found</h1>",
    "_next/static/chunks/app.js": "console.log('app')",
}


class FakeLlm:
    """Stands in for LiteLlmClient: returns scripted turns (or raises) and records each call.

    Drafting turns (response models with `updates`) use reply/updates/switch_to; selection turns
    use selection_reply/template_id. `error` fails every call; `errors` fails given calls (1-based).
    `on_call` runs before each call (e.g. to advance a fake clock).
    """

    def __init__(self) -> None:
        self.reply = "Thanks! Who is the other party?"
        self.updates: dict[str, Any] = {}
        self.switch_to: str | None = None
        self.selection_reply = "Which document do you need?"
        self.template_id: str | None = None
        self.error: LlmError | None = None
        self.errors: dict[int, LlmError] = {}
        self.on_call: Callable[[], None] | None = None
        self.calls: list[list[dict[str, str]]] = []
        self.models: list[str] = []
        self.timeouts: list[float | None] = []
        self.max_retries: list[int | None] = []

    def complete(
        self,
        messages: list[dict[str, str]],
        response_model: type[BaseModel],
        *,
        timeout: float | None = None,
        max_retries: int | None = None,
    ) -> BaseModel:
        if self.on_call:
            self.on_call()
        self.calls.append(messages)
        self.models.append(response_model.__name__)
        self.timeouts.append(timeout)
        self.max_retries.append(max_retries)
        error = self.errors.get(len(self.calls), self.error)
        if error:
            raise error
        fields = response_model.model_fields
        if "updates" in fields:
            # Every slot is required by the strict schema, so fill the unspecified ones with null.
            slots = fields["updates"].annotation.model_fields
            payload: dict[str, Any] = {
                "reply": self.reply,
                "updates": {k: self.updates.get(k) for k in slots},
            }
            if "switch_to" in fields:
                payload["switch_to"] = self.switch_to
        else:
            payload = {"reply": self.selection_reply, "template_id": self.template_id}
        return response_model.model_validate_json(json.dumps(payload))


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    root = tmp_path / "out"
    for rel, content in FAKE_EXPORT.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(content, encoding="utf-8")
    return root


@pytest.fixture
def settings(tmp_path: Path, static_dir: Path) -> Settings:
    return Settings(db_path=tmp_path / "data" / "prelegal.db", static_dir=static_dir)


@pytest.fixture
def fake_llm() -> FakeLlm:
    return FakeLlm()


@pytest.fixture
def client(settings: Settings, fake_llm: FakeLlm) -> Iterator[TestClient]:
    # The context manager runs the lifespan, which creates the database. Tests never call OpenAI.
    with TestClient(create_app(settings, llm=fake_llm)) as c:
        yield c
