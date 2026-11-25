import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

from fastapi.testclient import TestClient

from app.config import Settings
from tests.conftest import PASSWORD


def user_rows(settings: Settings) -> list[tuple]:
    with closing(sqlite3.connect(settings.db_path)) as conn:
        return conn.execute("SELECT id, name, email FROM users ORDER BY id").fetchall()


def test_health(client: TestClient) -> None:
    # The client fixture also mounts a frontend at "/": API routes must not be shadowed by it.
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_unknown_api_path_is_json_404(client: TestClient) -> None:
    for method in ("get", "post", "put", "delete"):
        res = client.request(method, "/api/does-not-exist")
        assert res.status_code == 404
        assert res.headers["content-type"].startswith("application/json")
        assert res.json() == {"detail": "Not found"}


def test_the_fake_sign_in_is_gone(client: TestClient) -> None:
    res = client.post("/api/session", json={"name": "Jane", "email": "jane@example.com"})
    assert res.status_code == 404
    assert res.json() == {"detail": "Not found"}


def test_concurrent_sign_ups_all_persist(client: TestClient, settings: Settings) -> None:
    # Regression: a request's connection is opened, used and closed on different threadpool
    # threads, which sqlite3 rejects unless check_same_thread=False.
    def sign_up(i: int) -> int:
        body = {"name": f"User {i}", "email": f"user{i}@example.com", "password": PASSWORD}
        return client.post("/api/auth/signup", json=body).status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(sign_up, range(settings.auth_rate_limit)))
    assert statuses == [201] * settings.auth_rate_limit
    assert len(user_rows(settings)) == settings.auth_rate_limit


def test_openapi_docs_live_under_api(client: TestClient) -> None:
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/api/docs").status_code == 200


# ---- Behind the Vercel rewrite (ApiPathMiddleware) ----


def test_api_paths_accept_a_trailing_slash(client: TestClient) -> None:
    # Vercel's trailingSlash redirect may send /api/x/ to the backend: it must not redirect again.
    res = client.get("/api/health/", follow_redirects=False)
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    res = client.post(
        "/api/auth/signup/",
        json={"name": "Jane", "email": "jane@example.com", "password": PASSWORD},
        follow_redirects=False,
    )
    assert res.status_code == 201
    assert client.get("/api/auth/me/", follow_redirects=False).json()["email"] == "jane@example.com"
    assert client.get("/api/documents/?x=1", follow_redirects=False).status_code == 200


def test_api_responses_are_never_cached(client: TestClient) -> None:
    for res in (client.get("/api/health"), client.get("/api/auth/me"), client.get("/api/nope")):
        assert res.headers.get_list("cache-control") == ["no-store"]


def test_frontend_pages_keep_their_own_caching(client: TestClient) -> None:
    res = client.get("/")
    assert res.status_code == 200
    assert "no-store" not in res.headers.get("cache-control", "")
    # Page routes keep the static export's trailing-slash redirect.
    assert client.get("/login", follow_redirects=False).status_code in (307, 308)
