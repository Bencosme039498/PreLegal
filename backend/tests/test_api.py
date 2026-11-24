import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.config import Settings


def user_rows(settings: Settings) -> list[tuple]:
    with closing(sqlite3.connect(settings.db_path)) as conn:
        return conn.execute("SELECT id, name, email FROM users ORDER BY id").fetchall()


def test_health(client: TestClient) -> None:
    # The client fixture also mounts a frontend at "/": API routes must not be shadowed by it.
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_session_creates_user(client: TestClient, settings: Settings) -> None:
    res = client.post("/api/session", json={"name": "Jane Smith", "email": "jane@example.com"})
    assert res.status_code == 200
    body = res.json()
    assert body == {"id": body["id"], "name": "Jane Smith", "email": "jane@example.com"}
    assert isinstance(body["id"], int)
    assert user_rows(settings) == [(body["id"], "Jane Smith", "jane@example.com")]


def test_session_normalises_input(client: TestClient) -> None:
    res = client.post("/api/session", json={"name": "  Jane  ", "email": "  Jane@Example.COM "})
    assert res.status_code == 200
    assert res.json()["name"] == "Jane"
    assert res.json()["email"] == "jane@example.com"


def test_session_same_email_updates_name_and_keeps_id(client: TestClient, settings: Settings) -> None:
    first = client.post("/api/session", json={"name": "Jane", "email": "jane@example.com"}).json()
    second = client.post("/api/session", json={"name": "Jane Smith", "email": "JANE@example.com"}).json()
    assert second["id"] == first["id"]
    assert second["name"] == "Jane Smith"
    assert user_rows(settings) == [(first["id"], "Jane Smith", "jane@example.com")]


def test_session_different_emails_are_different_users(client: TestClient, settings: Settings) -> None:
    a = client.post("/api/session", json={"name": "A", "email": "a@example.com"}).json()
    b = client.post("/api/session", json={"name": "B", "email": "b@example.com"}).json()
    assert a["id"] != b["id"]
    assert len(user_rows(settings)) == 2


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": "Jane"},
        {"email": "jane@example.com"},
        {"name": "", "email": "jane@example.com"},
        {"name": "   ", "email": "jane@example.com"},
        {"name": "x" * 101, "email": "jane@example.com"},
        {"name": "Jane", "email": "jane"},
        {"name": "Jane", "email": "jane@example"},
        {"name": "Jane", "email": "ja ne@example.com"},
        {"name": "Jane", "email": "a" * 250 + "@example.com"},
    ],
)
def test_session_rejects_invalid_input(client: TestClient, settings: Settings, payload: dict) -> None:
    res = client.post("/api/session", json=payload)
    assert res.status_code == 422
    assert user_rows(settings) == []


def test_unknown_api_path_is_json_404(client: TestClient) -> None:
    for method in ("get", "post", "delete"):
        res = client.request(method, "/api/does-not-exist")
        assert res.status_code == 404
        assert res.headers["content-type"].startswith("application/json")
        assert res.json() == {"detail": "Not found"}


def test_concurrent_sessions_all_persist(client: TestClient, settings: Settings) -> None:
    # Regression: a request's connection is opened, used and closed on different threadpool
    # threads, which sqlite3 rejects unless check_same_thread=False.
    def sign_in(i: int) -> int:
        return client.post(
            "/api/session", json={"name": f"User {i}", "email": f"user{i}@example.com"}
        ).status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(sign_in, range(40)))
    assert statuses == [200] * 40
    assert len(user_rows(settings)) == 40


def test_openapi_docs_live_under_api(client: TestClient) -> None:
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/api/docs").status_code == 200
