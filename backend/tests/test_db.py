import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import Settings
from app.main import create_app
from tests.conftest import PASSWORD, sign_up


def count(path: Path, table: str) -> int:
    with closing(sqlite3.connect(path)) as conn:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def columns(path: Path, table: str) -> list[str]:
    with closing(sqlite3.connect(path)) as conn:
        return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


def test_init_database_creates_the_schema(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "prelegal.db"
    db.init_database(path)
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


def test_data_and_sessions_survive_a_restart_by_default(settings: Settings) -> None:
    """Production: a restart or redeploy (a new process on the same disk) keeps everything."""
    assert settings.db_reset is False
    with TestClient(create_app(settings)) as client:
        sign_up(client)
        doc = client.post(
            "/api/documents", json={"template_id": "mutual-nda", "values": {"governing_law": "Delaware"}}
        )
        cookies = dict(client.cookies)
    with TestClient(create_app(settings), cookies=cookies) as client:
        assert [count(settings.db_path, t) for t in ("users", "sessions", "documents")] == [1, 1, 1]
        # The same cookie still signs the user in, and their draft is intact.
        assert client.get("/api/auth/me").json()["email"] == "jane@example.com"
        saved = client.get(f"/api/documents/{doc.json()['id']}").json()
        assert saved["values"] == {"governing_law": "Delaware"}
        # The password still works too, and new ids don't reuse old ones.
        client.post("/api/auth/logout")
        res = client.post("/api/auth/login", json={"email": "jane@example.com", "password": PASSWORD})
        assert res.status_code == 200
        assert (
            client.post("/api/documents", json={"template_id": "mutual-nda"}).json()["id"] > doc.json()["id"]
        )


def test_users_stay_isolated_after_a_restart(settings: Settings) -> None:
    with TestClient(create_app(settings)) as jane:
        sign_up(jane)
        doc_id = jane.post("/api/documents", json={"template_id": "mutual-nda"}).json()["id"]
    with TestClient(create_app(settings)) as bob:
        sign_up(bob, email="bob@example.com", name="Bob")
        assert bob.get("/api/documents").json() == []
        assert bob.get(f"/api/documents/{doc_id}").status_code == 404
        assert bob.delete(f"/api/documents/{doc_id}").status_code == 404
    assert count(settings.db_path, "documents") == 1


def test_db_reset_gives_a_fresh_database_on_every_start(settings: Settings) -> None:
    """Local Docker scripts and tests: PRELEGAL_DB_RESET=true wipes the database on start."""
    settings = settings.model_copy(update={"db_reset": True})
    with TestClient(create_app(settings)) as client:
        sign_up(client)
        client.post("/api/documents", json={"template_id": "mutual-nda"})
        assert [count(settings.db_path, t) for t in ("users", "sessions", "documents")] == [1, 1, 1]
        # The cookie outlives the restart below, but its session doesn't.
        cookies = dict(client.cookies)
    with TestClient(create_app(settings), cookies=cookies) as client:
        assert [count(settings.db_path, t) for t in ("users", "sessions", "documents")] == [0, 0, 0]
        assert client.get("/api/auth/me").status_code == 401


def test_db_reset_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PRELEGAL_DB_RESET", raising=False)
    assert Settings().db_reset is False
    monkeypatch.setenv("PRELEGAL_DB_RESET", "true")
    assert Settings().db_reset is True


def test_init_database_is_idempotent_and_stamps_the_schema_version(tmp_path: Path) -> None:
    path = tmp_path / "prelegal.db"
    db.init_database(path)
    with db.connect(path) as conn:
        db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
    db.init_database(path)
    assert count(path, "users") == 1
    with closing(sqlite3.connect(path)) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION


def test_a_database_from_another_schema_version_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "prelegal.db"
    db.init_database(path)
    with closing(sqlite3.connect(path)) as conn:
        conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
    with pytest.raises(db.SchemaVersionError):
        db.init_database(path)
    db.init_database(path, reset=True)  # a reset (local development only) starts over instead
    with closing(sqlite3.connect(path)) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION


def test_connect_rolls_back_on_error(tmp_path: Path) -> None:
    path = tmp_path / "prelegal.db"
    db.init_database(path)
    with pytest.raises(RuntimeError), db.connect(path) as conn:
        db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
        raise RuntimeError("boom")
    assert count(path, "users") == 0


def test_deleting_a_user_deletes_their_sessions_and_documents(tmp_path: Path) -> None:
    path = tmp_path / "prelegal.db"
    db.init_database(path)
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
    db.init_database(path)
    with db.connect(path) as conn:
        assert db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
        assert db.create_user(conn, name="Jane", email="JANE@example.com", password_hash="y") is None
