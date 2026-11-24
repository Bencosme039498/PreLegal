import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import Settings
from app.main import create_app
from tests.conftest import sign_up


def count(path: Path, table: str) -> int:
    with closing(sqlite3.connect(path)) as conn:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def columns(path: Path, table: str) -> list[str]:
    with closing(sqlite3.connect(path)) as conn:
        return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


def test_reset_database_creates_the_schema(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "prelegal.db"
    db.reset_database(path)
    assert columns(path, "users") == ["id", "name", "email", "password_hash", "created_at"]
    assert columns(path, "sessions") == ["token_hash", "user_id", "expires_at"]
    assert columns(path, "documents") == [
        "id",
        "user_id",
        "template_id",
        "title",
        "field_values",
        "messages",
        "complete",
        "created_at",
        "updated_at",
    ]


def test_each_app_start_gives_a_fresh_database(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        sign_up(client)
        client.post("/api/documents", json={"template_id": "mutual-nda"})
        assert [count(settings.db_path, t) for t in ("users", "sessions", "documents")] == [1, 1, 1]
        # The cookie outlives the restart below, but its session doesn't.
        cookies = dict(client.cookies)
    # A second start (like a new container) begins with an empty database.
    with TestClient(create_app(settings), cookies=cookies) as client:
        assert [count(settings.db_path, t) for t in ("users", "sessions", "documents")] == [0, 0, 0]
        assert client.get("/api/auth/me").status_code == 401


def test_connect_rolls_back_on_error(tmp_path: Path) -> None:
    path = tmp_path / "prelegal.db"
    db.reset_database(path)
    with pytest.raises(RuntimeError), db.connect(path) as conn:
        db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
        raise RuntimeError("boom")
    assert count(path, "users") == 0


def test_deleting_a_user_deletes_their_sessions_and_documents(tmp_path: Path) -> None:
    path = tmp_path / "prelegal.db"
    db.reset_database(path)
    with db.connect(path) as conn:
        user = db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
        db.create_session(conn, token_hash="t", user_id=user["id"], expires_at=2.0, now=1.0)
        db.create_document(
            conn, user["id"], template_id="mutual-nda", title="NDA", values={}, messages=[], complete=False
        )
    with db.connect(path) as conn:
        conn.execute("DELETE FROM users")
    assert count(path, "sessions") == 0
    assert count(path, "documents") == 0


def test_duplicate_email_is_case_insensitive(tmp_path: Path) -> None:
    path = tmp_path / "prelegal.db"
    db.reset_database(path)
    with db.connect(path) as conn:
        assert db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
        assert db.create_user(conn, name="Jane", email="JANE@example.com", password_hash="y") is None
