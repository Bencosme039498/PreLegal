import json
from collections.abc import Iterator
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
    """Stands in for LiteLlmClient: returns a scripted turn (or raises) and records each call."""

    def __init__(self) -> None:
        self.reply = "Thanks! Who is the other party?"
        self.updates: dict[str, Any] = {}
        self.error: LlmError | None = None
        self.calls: list[list[dict[str, str]]] = []

    def complete(self, messages: list[dict[str, str]], response_model: type[BaseModel]) -> BaseModel:
        self.calls.append(messages)
        if self.error:
            raise self.error
        # Every slot is required by the strict schema, so fill the unspecified ones with null.
        slots = response_model.model_fields["updates"].annotation.model_fields
        updates = {key: self.updates.get(key) for key in slots}
        return response_model.model_validate_json(json.dumps({"reply": self.reply, "updates": updates}))


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
