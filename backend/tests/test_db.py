import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import Settings
from app.main import create_app


def count_users(path: Path) -> int:
    with closing(sqlite3.connect(path)) as conn:
        return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def test_reset_database_creates_users_table(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "prelegal.db"
    db.reset_database(path)
    with closing(sqlite3.connect(path)) as conn:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(users)")]
    assert columns == ["id", "name", "email", "created_at"]


def test_each_app_start_gives_a_fresh_database(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        client.post("/api/session", json={"name": "Jane", "email": "jane@example.com"})
        assert count_users(settings.db_path) == 1
    # A second start (like a new container) begins with an empty database.
    with TestClient(create_app(settings)):
        assert count_users(settings.db_path) == 0


def test_connect_rolls_back_on_error(tmp_path: Path) -> None:
    path = tmp_path / "prelegal.db"
    db.reset_database(path)
    with pytest.raises(RuntimeError), db.connect(path) as conn:
        db.upsert_user(conn, name="Jane", email="jane@example.com")
        raise RuntimeError("boom")
    assert count_users(path) == 0
