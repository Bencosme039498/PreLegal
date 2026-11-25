"""The database layer and the reset policy.

Most tests use the `settings` fixture, so they run against SQLite by default and against PostgreSQL
when PRELEGAL_TEST_DATABASE_URL is set (CI runs both).
"""

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app import db
from app.config import Settings
from app.main import create_app
from tests.conftest import PASSWORD, TEST_DATABASE_URL, rows, sign_up

TABLES = ("users", "sessions", "documents")
postgres_only = pytest.mark.skipif(not TEST_DATABASE_URL, reason="needs PRELEGAL_TEST_DATABASE_URL")


def counts(settings: Settings) -> list[int]:
    return [len(rows(settings, f"SELECT * FROM {table}")) for table in TABLES]


def opened(settings: Settings) -> db.Database:
    database = db.open_database(settings)
    database.init(reset=settings.db_reset)
    return database


# ---- Choosing the database ----


def test_sqlite_unless_a_database_url_is_set(tmp_path: Path) -> None:
    assert isinstance(db.open_database(Settings(db_path=tmp_path / "x.db")), db.SqliteDatabase)
    pg = Settings(database_url="postgresql://u:p@localhost/prelegal")
    assert isinstance(db.open_database(pg), db.PostgresDatabase)


def test_database_url_is_read_from_the_environment_and_kept_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:s3cret@db.example.com/prelegal?sslmode=require")
    settings = Settings()
    assert isinstance(settings.database_url, SecretStr)
    assert "s3cret" not in repr(settings) and "s3cret" not in str(settings.database_url)
    monkeypatch.setenv("DATABASE_URL", "")
    assert Settings().database_url is None


def test_database_url_must_be_postgres() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="mysql://u:p@localhost/prelegal")


def test_reset_is_refused_for_postgres() -> None:
    # A reset deletes everything: it must never be possible against the production database.
    with pytest.raises(ValidationError):
        Settings(database_url="postgresql://u:p@localhost/prelegal", db_reset=True)
    with pytest.raises(ValueError):
        db.PostgresDatabase("postgresql://u:p@localhost/prelegal").init(reset=True)


def test_db_reset_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PRELEGAL_DB_RESET", raising=False)
    assert Settings().db_reset is False
    monkeypatch.setenv("PRELEGAL_DB_RESET", "true")
    assert Settings().db_reset is True


# ---- Persistence (production behaviour) ----


def test_data_and_sessions_survive_a_restart_by_default(settings: Settings) -> None:
    """Production: a restart or redeploy (a new process, same database) keeps everything."""
    assert settings.db_reset is False
    with TestClient(create_app(settings)) as client:
        sign_up(client)
        doc = client.post(
            "/api/documents", json={"template_id": "mutual-nda", "values": {"governing_law": "Delaware"}}
        )
        cookies = dict(client.cookies)
    with TestClient(create_app(settings), cookies=cookies) as client:
        assert counts(settings) == [1, 1, 1]
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
        assert bob.put(f"/api/documents/{doc_id}", json={"title": "x"}).status_code == 404
        assert bob.delete(f"/api/documents/{doc_id}").status_code == 404
    assert counts(settings)[2] == 1


def test_init_is_idempotent_and_stamps_the_schema_version(settings: Settings) -> None:
    database = opened(settings)
    try:
        with database.connect() as conn:
            db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
        database.init()
        assert counts(settings)[0] == 1
        assert rows(settings, "SELECT version FROM schema_version") == [(db.SCHEMA_VERSION,)]
    finally:
        database.close()


def test_a_database_from_another_schema_version_is_refused(settings: Settings) -> None:
    opened(settings).close()
    rows(settings, f"UPDATE schema_version SET version = {db.SCHEMA_VERSION + 1}")
    with pytest.raises(db.SchemaVersionError):
        opened(settings)


def test_connect_rolls_back_on_error(settings: Settings) -> None:
    database = opened(settings)
    try:
        with pytest.raises(RuntimeError), database.connect() as conn:
            db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
            raise RuntimeError("boom")
        assert counts(settings)[0] == 0
    finally:
        database.close()


def test_deleting_a_user_deletes_their_sessions_and_documents(settings: Settings) -> None:
    database = opened(settings)
    try:
        with database.connect() as conn:
            user = db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
            db.create_session(conn, token_hash="t", user_id=user["id"], expires_at=2.0, now=1.0)
            db.create_document(
                conn,
                user["id"],
                template_id="mutual-nda",
                title="NDA",
                values={},
                messages=[],
                complete=False,
            )
        with database.connect() as conn:
            conn.execute("DELETE FROM users")
        assert counts(settings) == [0, 0, 0]
    finally:
        database.close()


def test_duplicate_email_is_case_insensitive_and_keeps_the_transaction_usable(settings: Settings) -> None:
    database = opened(settings)
    try:
        with database.connect() as conn:
            assert db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
            assert db.create_user(conn, name="Jane", email="JANE@example.com", password_hash="y") is None
            # Still usable afterwards (a failed INSERT would abort a PostgreSQL transaction).
            assert db.get_user_by_email(conn, "Jane@Example.com")["name"] == "Jane"
        assert rows(settings, "SELECT email FROM users") == [("jane@example.com",)]
    finally:
        database.close()


def test_timestamps_are_iso_utc_with_milliseconds(settings: Settings) -> None:
    database = opened(settings)
    try:
        with database.connect() as conn:
            user = db.create_user(conn, name="Jane", email="jane@example.com", password_hash="x")
            doc = db.create_document(
                conn, user["id"], template_id="mutual-nda", title="NDA", values={}, messages=[], complete=True
            )
        assert doc["complete"] is True
        assert doc["created_at"] == doc["updated_at"]
        assert len(doc["created_at"]) == len("2026-11-25T19:22:18.211Z") and doc["created_at"].endswith("Z")
    finally:
        database.close()


# ---- Reset (local SQLite only) ----


def test_sqlite_schema(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "prelegal.db"
    db.SqliteDatabase(path).init()
    with closing(sqlite3.connect(path)) as conn:
        cols = {t: [r[1] for r in conn.execute(f"PRAGMA table_info({t})")] for t in TABLES}
    assert cols["users"] == ["id", "name", "email", "password_hash", "created_at"]
    assert cols["sessions"] == ["token_hash", "user_id", "expires_at"]
    assert cols["documents"] == [
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


def test_db_reset_gives_a_fresh_sqlite_database_on_every_start(tmp_path: Path, static_dir: Path) -> None:
    """Local Docker scripts and tests: PRELEGAL_DB_RESET=true wipes the database on start."""
    settings = Settings(db_path=tmp_path / "reset.db", db_reset=True, static_dir=static_dir)
    with TestClient(create_app(settings)) as client:
        sign_up(client)
        client.post("/api/documents", json={"template_id": "mutual-nda"})
        assert counts(settings) == [1, 1, 1]
        # The cookie outlives the restart below, but its session doesn't.
        cookies = dict(client.cookies)
    with TestClient(create_app(settings), cookies=cookies) as client:
        assert counts(settings) == [0, 0, 0]
        assert client.get("/api/auth/me").status_code == 401


def test_sqlite_reset_also_clears_another_schema_version(tmp_path: Path) -> None:
    settings = Settings(db_path=tmp_path / "old.db")
    opened(settings).close()
    rows(settings, "UPDATE schema_version SET version = 99")
    opened(settings.model_copy(update={"db_reset": True})).close()
    assert rows(settings, "SELECT version FROM schema_version") == [(db.SCHEMA_VERSION,)]


# ---- PostgreSQL specifics ----


@postgres_only
def test_postgres_holds_no_connection_while_idle(settings: Settings) -> None:
    """The null pool closes each connection after use, so Neon's compute can scale to zero."""
    with TestClient(create_app(settings)) as client:
        sign_up(client)
        client.get("/api/documents")
        # Checked while the app is still running: its other connections are all closed already.
        open_now = rows(
            settings,
            "SELECT COUNT(*) FROM pg_stat_activity"
            " WHERE datname = current_database() AND pid <> pg_backend_pid()",
        )
    assert open_now == [(0,)]
