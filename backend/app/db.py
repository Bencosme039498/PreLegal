"""Temporary SQLite database, created from scratch on every start (stdlib sqlite3, no ORM)."""

import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
"""


def reset_database(path: Path) -> None:
    """Delete any existing database at `path` and create the schema."""
    path.unlink(missing_ok=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as conn:
        conn.executescript(SCHEMA)


@contextmanager
def connect(path: Path) -> Iterator[sqlite3.Connection]:
    """A connection that commits on success, rolls back on error and always closes."""
    # FastAPI runs a sync dependency's setup, the endpoint and the teardown as separate threadpool
    # calls, so one request's connection may be used from several threads (never concurrently).
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert_user(conn: sqlite3.Connection, *, name: str, email: str) -> sqlite3.Row:
    """Create the user, or update their name if the email (case-insensitive) already exists."""
    return conn.execute(
        """
        INSERT INTO users (name, email) VALUES (?, ?)
        ON CONFLICT (email) DO UPDATE SET name = excluded.name
        RETURNING id, name, email
        """,
        (name, email),
    ).fetchone()
