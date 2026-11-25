"""The database: SQLite locally (stdlib sqlite3), PostgreSQL in production (psycopg). No ORM.

`open_database(settings)` picks the backend: PostgreSQL when DATABASE_URL is set (Neon in
production), otherwise the SQLite file at PRELEGAL_DB_PATH. Both keep their data across restarts;
only SQLite can be reset on start (PRELEGAL_DB_RESET=true: local Docker scripts, tests).

The queries below are written once, in SQL both databases understand: `?` placeholders (translated
for psycopg), `RETURNING`, `ON CONFLICT DO NOTHING`, timestamps passed in from Python. Only the table
definitions differ. Every document query is scoped by user_id: a document id alone never reaches
another user's data.
"""

import json
import sqlite3
from collections.abc import Iterator, Mapping, Sequence
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from .config import Settings

# Bumped whenever the schema changes; a database at another version needs a migration first.
SCHEMA_VERSION = 1

# Created first, so the version is checked before any other table is touched.
_VERSION_TABLE = "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"

# Emails are unique case-insensitively (the lower(email) index) and stored as typed.
_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

-- Sign-in sessions: the cookie holds a random token, the table only its SHA-256.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at REAL NOT NULL -- Unix time
);

-- A user's drafts: the field values and the chat that filled them in (both JSON).
CREATE TABLE IF NOT EXISTS documents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    template_id  TEXT NOT NULL,
    title        TEXT NOT NULL,
    field_values TEXT NOT NULL,
    messages     TEXT NOT NULL,
    complete     INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_by_user ON documents (user_id, updated_at DESC);
"""

# The same tables in PostgreSQL types (identity ids, which, like AUTOINCREMENT, are never reused).
_POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS documents (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    template_id  TEXT NOT NULL,
    title        TEXT NOT NULL,
    field_values TEXT NOT NULL,
    messages     TEXT NOT NULL,
    complete     INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_by_user ON documents (user_id, updated_at DESC);
"""

# Every table the app owns, children first (for tests that empty a PostgreSQL database).
TABLES = ("documents", "sessions", "users", "schema_version")

Row = Mapping[str, Any]


class SchemaVersionError(RuntimeError):
    """The database was created for a different schema version."""


class Cursor(Protocol):
    rowcount: int

    def fetchone(self) -> Any: ...
    def fetchall(self) -> list[Any]: ...


class Conn:
    """One connection inside one transaction, with `?` placeholders on both databases.

    Rows are mappings (sqlite3.Row or psycopg's dict rows): read them by column name.
    """

    def __init__(self, raw: Any, *, placeholder: str) -> None:
        self._raw = raw
        self._placeholder = placeholder

    def execute(self, sql: str, params: Sequence[Any] = ()) -> Cursor:
        if self._placeholder == "?":
            return self._raw.execute(sql, params)
        # psycopg: no query here contains a literal "?" or "%"; and no parameters must be None,
        # not (), for a multi-statement script to run.
        return self._raw.execute(sql.replace("?", self._placeholder), params or None)


def _check_version(conn: Conn, where: str) -> None:
    conn.execute(_VERSION_TABLE)
    row = conn.execute("SELECT version FROM schema_version").fetchone()
    if row is None:
        conn.execute("INSERT INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,))
    elif row["version"] != SCHEMA_VERSION:
        raise SchemaVersionError(
            f"{where} has schema version {row['version']}, this code expects {SCHEMA_VERSION}; "
            "migrate it first"
        )


class SqliteDatabase:
    """A SQLite file: the local Docker scripts, `uv run uvicorn` and the tests."""

    kind = "sqlite"

    def __init__(self, path: Path) -> None:
        self.path = path

    def init(self, *, reset: bool = False) -> None:
        """Create the file and schema if needed. reset=True deletes the file first (local only)."""
        if reset:
            self.path.unlink(missing_ok=True)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            _check_version(conn, str(self.path))
        # executescript commits on its own, so it runs after the version check has been committed.
        with closing(sqlite3.connect(self.path)) as raw:
            raw.executescript(_SQLITE_SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[Conn]:
        """A connection that commits on success, rolls back on error and always closes."""
        # FastAPI runs a sync dependency's setup, the endpoint and the teardown as separate
        # threadpool calls, so one request's connection may be used from several threads (never
        # concurrently).
        raw = sqlite3.connect(self.path, check_same_thread=False)
        raw.row_factory = sqlite3.Row
        raw.execute("PRAGMA foreign_keys = ON")  # per connection; makes ON DELETE CASCADE work
        try:
            yield Conn(raw, placeholder="?")
            raw.commit()
        except BaseException:
            raw.rollback()
            raise
        finally:
            raw.close()

    def close(self) -> None:
        pass


class PostgresDatabase:
    """PostgreSQL (Neon in production), reached through DATABASE_URL.

    A null pool: each request opens its own connection and closes it afterwards, so nothing stays
    connected while the app is idle and Neon's compute can scale to zero. Use Neon's pooled
    (`-pooler`) host. psycopg's automatic server-side prepared statements are off, as PgBouncer's
    transaction mode recommends.
    """

    kind = "postgres"

    def __init__(self, url: str, *, max_connections: int = 5, connect_timeout_s: int = 15) -> None:
        self._url = url
        self._max_connections = max_connections
        self._connect_timeout_s = connect_timeout_s
        self._pool: Any = None

    def init(self, *, reset: bool = False) -> None:
        """Open the pool and create the schema if needed. Never resets: production data is only
        ever migrated."""
        if reset:
            raise ValueError("PRELEGAL_DB_RESET only applies to the local SQLite database")
        # Imported here so local SQLite runs don't load the PostgreSQL driver.
        from psycopg.rows import dict_row
        from psycopg_pool import NullConnectionPool

        # A new pool per start: a closed pool can't be reopened (an app's lifespan may run again).
        self._pool = NullConnectionPool(
            self._url,
            max_size=self._max_connections,
            timeout=self._connect_timeout_s + 5,
            kwargs={
                "row_factory": dict_row,
                "prepare_threshold": None,
                "connect_timeout": self._connect_timeout_s,
            },
            open=True,
        )
        with self.connect() as conn:
            _check_version(conn, "the PostgreSQL database")
            conn.execute(_POSTGRES_SCHEMA)  # several statements: allowed without parameters

    @contextmanager
    def connect(self) -> Iterator[Conn]:
        """A connection in a transaction that commits on success and rolls back on error."""
        with self._pool.connection() as raw:
            yield Conn(raw, placeholder="%s")

    def close(self) -> None:
        if self._pool is not None:
            self._pool.close()
            self._pool = None


Database = SqliteDatabase | PostgresDatabase


def open_database(settings: "Settings") -> Database:
    """PostgreSQL when DATABASE_URL is set (production), otherwise the SQLite file."""
    if settings.database_url is not None:
        return PostgresDatabase(settings.database_url.get_secret_value())
    return SqliteDatabase(settings.db_path)


def _now() -> str:
    """UTC time as ISO 8601 with milliseconds, e.g. 2026-11-25T19:22:18.211Z."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---- Users and sessions ----


def create_user(conn: Conn, *, name: str, email: str, password_hash: str) -> Row | None:
    """The new user, or None if the email (case-insensitive) is already registered."""
    # ON CONFLICT instead of catching the error: a failed statement would abort a PostgreSQL
    # transaction, and the two drivers raise different exception types.
    return conn.execute(
        """
        INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT DO NOTHING RETURNING id, name, email
        """,
        (name, email, password_hash, _now()),
    ).fetchone()


def get_user_by_email(conn: Conn, email: str) -> Row | None:
    return conn.execute(
        "SELECT id, name, email, password_hash FROM users WHERE lower(email) = lower(?)", (email,)
    ).fetchone()


def create_session(conn: Conn, *, token_hash: str, user_id: int, expires_at: float, now: float) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))  # keep the table small
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, expires_at),
    )


def get_session_user(conn: Conn, *, token_hash: str, now: float) -> Row | None:
    """The user signed in with this token, if the session exists and hasn't expired."""
    return conn.execute(
        """
        SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        """,
        (token_hash, now),
    ).fetchone()


def delete_session(conn: Conn, token_hash: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


# ---- Documents ----

_DOC_SUMMARY = "id, template_id, title, complete, created_at, updated_at"
_DOC_FULL = f"{_DOC_SUMMARY}, field_values, messages"


def _summary(row: Row) -> dict[str, Any]:
    return {**dict(row), "complete": bool(row["complete"])}


def _document(row: Row | None) -> dict[str, Any] | None:
    """A full document (with its values and messages decoded), or None."""
    if row is None:
        return None
    doc = _summary(row)
    doc["values"] = json.loads(doc.pop("field_values"))
    doc["messages"] = json.loads(doc["messages"])
    return doc


def count_documents(conn: Conn, user_id: int) -> int:
    return conn.execute("SELECT COUNT(*) AS n FROM documents WHERE user_id = ?", (user_id,)).fetchone()["n"]


def list_documents(conn: Conn, user_id: int) -> list[dict[str, Any]]:
    """The user's documents (without values or messages), most recently edited first."""
    rows = conn.execute(
        f"SELECT {_DOC_SUMMARY} FROM documents WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
        (user_id,),
    ).fetchall()
    return [_summary(row) for row in rows]


def get_document(conn: Conn, user_id: int, doc_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT {_DOC_FULL} FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id)
    ).fetchone()
    return _document(row)


def create_document(
    conn: Conn,
    user_id: int,
    *,
    template_id: str,
    title: str,
    values: dict[str, str],
    messages: list[dict[str, str]],
    complete: bool,
) -> dict[str, Any]:
    now = _now()
    row = conn.execute(
        f"""
        INSERT INTO documents
            (user_id, template_id, title, field_values, messages, complete, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING {_DOC_FULL}
        """,
        (user_id, template_id, title, json.dumps(values), json.dumps(messages), int(complete), now, now),
    ).fetchone()
    return _document(row)


def update_document(
    conn: Conn,
    user_id: int,
    doc_id: int,
    *,
    title: str,
    values: dict[str, str],
    messages: list[dict[str, str]],
    complete: bool,
) -> dict[str, Any] | None:
    """Replaces the document's contents; None if the user has no such document."""
    row = conn.execute(
        f"""
        UPDATE documents SET title = ?, field_values = ?, messages = ?, complete = ?, updated_at = ?
        WHERE id = ? AND user_id = ? RETURNING {_DOC_FULL}
        """,
        (title, json.dumps(values), json.dumps(messages), int(complete), _now(), doc_id, user_id),
    ).fetchone()
    return _document(row)


def delete_document(conn: Conn, user_id: int, doc_id: int) -> bool:
    cur = conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id))
    return cur.rowcount > 0
