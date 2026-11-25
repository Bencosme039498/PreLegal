import json
import os
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.config import Settings
from app.llm import LlmError
from app.main import create_app

# Set (e.g. postgresql://postgres:postgres@localhost:5432/prelegal_test) to run the whole suite
# against PostgreSQL instead of SQLite. Each test starts from an empty database. CI runs both.
TEST_DATABASE_URL = os.environ.get("PRELEGAL_TEST_DATABASE_URL") or None

# A miniature Next.js static export (trailingSlash: true layout).
FAKE_EXPORT = {
    "index.html": "<h1>home</h1>",
    "login/index.html": "<h1>login</h1>",
    "signup/index.html": "<h1>signup</h1>",
    "documents/index.html": "<h1>documents</h1>",
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
        self.prepared = 0

    def prepare(self) -> None:
        self.prepared += 1

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


@pytest.fixture(autouse=True)
def _no_ambient_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """A DATABASE_URL in the developer's shell must never point the tests at a real database."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("PRELEGAL_DATABASE_URL", raising=False)


def _empty_postgres(url: str) -> None:
    import psycopg

    from app.db import TABLES

    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f"DROP TABLE IF EXISTS {', '.join(TABLES)} CASCADE")


@pytest.fixture
def settings(tmp_path: Path, static_dir: Path) -> Settings:
    if TEST_DATABASE_URL:
        _empty_postgres(TEST_DATABASE_URL)
        return Settings(database_url=TEST_DATABASE_URL, db_path=tmp_path / "unused.db", static_dir=static_dir)
    return Settings(db_path=tmp_path / "data" / "prelegal.db", static_dir=static_dir)


def rows(settings: Settings, sql: str) -> list[tuple]:
    """Runs one statement directly against the test database (committed); its rows as tuples."""
    if settings.database_url is not None:
        import psycopg

        with psycopg.connect(settings.database_url.get_secret_value()) as conn:
            cur = conn.execute(sql)
            return cur.fetchall() if cur.description else []
    with closing(sqlite3.connect(settings.db_path)) as conn:
        cur = conn.execute(sql)
        result = cur.fetchall()
        conn.commit()
        return result


@pytest.fixture
def fake_llm() -> FakeLlm:
    return FakeLlm()


@pytest.fixture
def client(settings: Settings, fake_llm: FakeLlm, clock: "FakeClock") -> Iterator[TestClient]:
    # The context manager runs the lifespan, which creates the database. Tests never call OpenAI.
    # The client starts signed out; sign_up() signs it in (it keeps the session cookie).
    with TestClient(create_app(settings, llm=fake_llm, clock=clock)) as c:
        yield c


class FakeClock:
    """Unix time that only moves when a test advances it (session expiry, rate limits)."""

    def __init__(self, start: float = 1_800_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


PASSWORD = "correct horse battery"


def sign_up(client: TestClient, email: str = "jane@example.com", name: str = "Jane Smith") -> dict[str, Any]:
    """Creates an account; the client keeps its session cookie, so later requests are signed in."""
    res = client.post("/api/auth/signup", json={"name": name, "email": email, "password": PASSWORD})
    assert res.status_code == 201, res.text
    return res.json()
