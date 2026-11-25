"""The SQLite database (stdlib sqlite3, no ORM). It persists across restarts; with
`PRELEGAL_DB_RESET=true` (local Docker scripts, tests) it is recreated on every start instead.

Every document query is scoped by user_id: a document id alone never reaches another user's data.
"""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

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
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS documents_by_user ON documents (user_id, updated_at DESC);
"""


# Bumped whenever SCHEMA changes; an existing database at another version needs a migration first.
SCHEMA_VERSION = 1


class SchemaVersionError(RuntimeError):
    """The database file was created for a different schema version."""


def init_database(path: Path, *, reset: bool = False) -> None:
    """Open (or create) the database at `path` and make sure the schema exists.

    reset=True deletes any existing file first (local development and tests only). Otherwise
    existing data is kept, and a file stamped with another schema version is refused rather than
    used, so a deploy can never quietly run against tables it doesn't understand.
    """
    if reset:
        path.unlink(missing_ok=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as conn:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, SCHEMA_VERSION):
            raise SchemaVersionError(
                f"{path} has schema version {version}, this code expects {SCHEMA_VERSION}; migrate it first"
            )
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()


@contextmanager
def connect(path: Path) -> Iterator[sqlite3.Connection]:
    """A connection that commits on success, rolls back on error and always closes."""
    # FastAPI runs a sync dependency's setup, the endpoint and the teardown as separate threadpool
    # calls, so one request's connection may be used from several threads (never concurrently).
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # per connection; makes ON DELETE CASCADE work
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---- Users and sessions ----


def create_user(conn: sqlite3.Connection, *, name: str, email: str, password_hash: str) -> sqlite3.Row | None:
    """The new user, or None if the email (case-insensitive) is already registered."""
    try:
        return conn.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) RETURNING id, name, email",
            (name, email, password_hash),
        ).fetchone()
    except sqlite3.IntegrityError:
        return None


def get_user_by_email(conn: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id, name, email, password_hash FROM users WHERE email = ?", (email,)
    ).fetchone()


def create_session(
    conn: sqlite3.Connection, *, token_hash: str, user_id: int, expires_at: float, now: float
) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))  # keep the table small
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, expires_at),
    )


def get_session_user(conn: sqlite3.Connection, *, token_hash: str, now: float) -> sqlite3.Row | None:
    """The user signed in with this token, if the session exists and hasn't expired."""
    return conn.execute(
        """
        SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        """,
        (token_hash, now),
    ).fetchone()


def delete_session(conn: sqlite3.Connection, token_hash: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


# ---- Documents ----

_DOC_SUMMARY = "id, template_id, title, complete, created_at, updated_at"
_DOC_FULL = f"{_DOC_SUMMARY}, field_values, messages"


def _summary(row: sqlite3.Row) -> dict[str, Any]:
    return {**dict(row), "complete": bool(row["complete"])}


def _document(row: sqlite3.Row | None) -> dict[str, Any] | None:
    """A full document (with its values and messages decoded), or None."""
    if row is None:
        return None
    doc = _summary(row)
    doc["values"] = json.loads(doc.pop("field_values"))
    doc["messages"] = json.loads(doc["messages"])
    return doc


def count_documents(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute("SELECT COUNT(*) FROM documents WHERE user_id = ?", (user_id,)).fetchone()[0]


def list_documents(conn: sqlite3.Connection, user_id: int) -> list[dict[str, Any]]:
    """The user's documents (without values or messages), most recently edited first."""
    rows = conn.execute(
        f"SELECT {_DOC_SUMMARY} FROM documents WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
        (user_id,),
    ).fetchall()
    return [_summary(row) for row in rows]


def get_document(conn: sqlite3.Connection, user_id: int, doc_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT {_DOC_FULL} FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id)
    ).fetchone()
    return _document(row)


def create_document(
    conn: sqlite3.Connection,
    user_id: int,
    *,
    template_id: str,
    title: str,
    values: dict[str, str],
    messages: list[dict[str, str]],
    complete: bool,
) -> dict[str, Any]:
    row = conn.execute(
        f"""
        INSERT INTO documents (user_id, template_id, title, field_values, messages, complete)
        VALUES (?, ?, ?, ?, ?, ?) RETURNING {_DOC_FULL}
        """,
        (user_id, template_id, title, json.dumps(values), json.dumps(messages), int(complete)),
    ).fetchone()
    return _document(row)


def update_document(
    conn: sqlite3.Connection,
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
        UPDATE documents
        SET title = ?, field_values = ?, messages = ?, complete = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND user_id = ? RETURNING {_DOC_FULL}
        """,
        (title, json.dumps(values), json.dumps(messages), int(complete), doc_id, user_id),
    ).fetchone()
    return _document(row)


def delete_document(conn: sqlite3.Connection, user_id: int, doc_id: int) -> bool:
    cur = conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id))
    return cur.rowcount > 0
