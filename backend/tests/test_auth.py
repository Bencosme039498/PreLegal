"""Accounts: sign up, sign in, sign out, sessions and the sign-in rate limit."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import auth
from app.config import Settings
from app.main import create_app
from tests.conftest import PASSWORD, FakeClock, FakeLlm, rows, sign_up

JANE = {"name": "Jane Smith", "email": "jane@example.com", "password": PASSWORD}


def login(client: TestClient, email: str = "jane@example.com", password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


# ---- Passwords ----


def test_password_hash_round_trip() -> None:
    stored = auth.hash_password("s3cret pass")
    assert stored.startswith("scrypt$") and "s3cret" not in stored
    assert auth.verify_password("s3cret pass", stored)
    assert not auth.verify_password("s3cret pas", stored)
    assert auth.hash_password("s3cret pass") != stored  # salted


@pytest.mark.parametrize(
    "stored", ["", "plain", "bcrypt$1$2$3$a$b", "scrypt$x$8$1$AAAA$AAAA", "scrypt$16$8$1$!!$!!"]
)
def test_malformed_hashes_never_verify(stored: str) -> None:
    assert not auth.verify_password("anything", stored)


# ---- Sign up ----


def test_sign_up_creates_the_account_and_signs_in(client: TestClient, settings: Settings) -> None:
    res = client.post(
        "/api/auth/signup", json={**JANE, "name": "  Jane Smith ", "email": " Jane@Example.COM "}
    )
    assert res.status_code == 201
    user = res.json()
    assert user == {"id": user["id"], "name": "Jane Smith", "email": "jane@example.com"}

    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{auth.COOKIE_NAME}=")
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
    assert "Secure" not in cookie  # cookie_secure is off for plain http://localhost
    assert client.get("/api/auth/me").json() == user

    [(password_hash,)] = rows(settings, "SELECT password_hash FROM users")
    assert auth.verify_password(PASSWORD, password_hash)
    # Only the token's hash is stored.
    [(token_hash,)] = rows(settings, "SELECT token_hash FROM sessions")
    assert token_hash == auth.hash_token(client.cookies[auth.COOKIE_NAME])


def test_sign_up_with_a_registered_email_is_409(client: TestClient, settings: Settings) -> None:
    sign_up(client)
    res = client.post("/api/auth/signup", json={**JANE, "email": "JANE@example.com", "name": "Other"})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "email_taken"
    assert rows(settings, "SELECT name FROM users") == [("Jane Smith",)]


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 101},
        {"email": "jane"},
        {"email": "jane@example"},
        {"email": "ja ne@example.com"},
        {"email": "a" * 250 + "@example.com"},
        {"password": "short"},
        {"password": "x" * 129},
    ],
)
def test_sign_up_rejects_invalid_input(client: TestClient, settings: Settings, overrides: dict) -> None:
    assert client.post("/api/auth/signup", json={**JANE, **overrides}).status_code == 422
    assert rows(settings, "SELECT * FROM users") == []


def test_sign_ups_are_rate_limited_per_address(
    client: TestClient, settings: Settings, clock: FakeClock
) -> None:
    for i in range(settings.auth_rate_limit):
        body = {**JANE, "email": f"u{i}@example.com"}
        assert client.post("/api/auth/signup", json=body).status_code == 201
    res = client.post("/api/auth/signup", json={**JANE, "email": "late@example.com"})
    assert res.status_code == 429
    assert res.json()["detail"]["code"] == "too_many_attempts"
    clock.advance(settings.auth_rate_window_s)
    assert client.post("/api/auth/signup", json={**JANE, "email": "late@example.com"}).status_code == 201


# ---- Sign in ----


def test_sign_in(client: TestClient) -> None:
    user = sign_up(client)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401

    res = login(client, email=" JANE@example.com ")
    assert res.status_code == 200
    assert res.json() == user
    assert client.get("/api/auth/me").json() == user


def test_wrong_password_and_unknown_email_look_the_same(client: TestClient) -> None:
    sign_up(client)
    client.cookies.clear()
    wrong = login(client, password="wrong password")
    unknown = login(client, email="nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["detail"]["code"] == "invalid_credentials"
    assert "set-cookie" not in wrong.headers
    assert client.get("/api/auth/me").status_code == 401


def test_failed_sign_ins_are_rate_limited(client: TestClient, settings: Settings, clock: FakeClock) -> None:
    sign_up(client)
    for _ in range(settings.auth_rate_limit):
        assert login(client, password="wrong password").status_code == 401
    # Locked out, even with the right password, until the window passes.
    res = login(client)
    assert res.status_code == 429
    detail = res.json()["detail"]
    assert (detail["code"], detail["retryable"]) == ("too_many_attempts", True)
    assert int(res.headers["retry-after"]) >= 1
    clock.advance(settings.auth_rate_window_s)
    assert login(client).status_code == 200


def test_successful_sign_ins_are_not_limited(client: TestClient, settings: Settings) -> None:
    sign_up(client)
    for _ in range(settings.auth_rate_limit + 2):
        assert login(client).status_code == 200


# ---- Sessions ----


def test_me_without_a_valid_session_is_401(client: TestClient) -> None:
    res = client.get("/api/auth/me")
    assert res.status_code == 401
    assert res.json()["detail"]["code"] == "not_authenticated"
    client.cookies.set(auth.COOKIE_NAME, "not-a-real-token")
    assert client.get("/api/auth/me").status_code == 401


def test_sessions_expire(client: TestClient, settings: Settings, clock: FakeClock) -> None:
    sign_up(client)
    clock.advance(settings.session_ttl_s - 1)
    assert client.get("/api/auth/me").status_code == 200
    clock.advance(1)
    assert client.get("/api/auth/me").status_code == 401


def test_sign_out_ends_the_session_on_the_server(client: TestClient, settings: Settings) -> None:
    sign_up(client)
    token = client.cookies[auth.COOKIE_NAME]
    res = client.post("/api/auth/logout")
    assert res.status_code == 204
    assert "Max-Age=0" in res.headers["set-cookie"]
    assert rows(settings, "SELECT * FROM sessions") == []
    # Replaying the old cookie doesn't work.
    client.cookies.set(auth.COOKIE_NAME, token)
    assert client.get("/api/auth/me").status_code == 401


def test_sign_out_without_a_session_succeeds(client: TestClient) -> None:
    assert client.post("/api/auth/logout").status_code == 204


def test_each_sign_in_is_a_separate_session(client: TestClient, settings: Settings) -> None:
    sign_up(client)
    first = client.cookies[auth.COOKIE_NAME]
    login(client)
    assert client.cookies[auth.COOKIE_NAME] != first
    assert len(rows(settings, "SELECT * FROM sessions")) == 2


def test_secure_cookie_when_served_over_https(settings: Settings, fake_llm: FakeLlm) -> None:
    secure = settings.model_copy(
        update={"cookie_secure": True, "db_path": settings.db_path.with_name("s.db")}
    )
    with TestClient(create_app(secure, llm=fake_llm), base_url="https://testserver") as client:
        for res in (
            client.post("/api/auth/signup", json=JANE),
            login(client),
            client.post("/api/auth/logout"),
        ):
            assert "Secure" in res.headers["set-cookie"]


def test_writes_are_committed_before_the_response_is_sent(settings: Settings, fake_llm: FakeLlm) -> None:
    # Regression: the browser's next request (e.g. GET /api/auth/me right after signing in) must see
    # the new session, so the transaction has to be committed when the response starts, not after.
    app = create_app(settings, llm=fake_llm)
    seen: list[int] = []

    async def observe(scope, receive, send):
        async def checked_send(message):
            if message["type"] == "http.response.start" and scope["path"] == "/api/auth/signup":
                seen.extend(row[0] for row in rows(settings, "SELECT COUNT(*) FROM sessions"))
            await send(message)

        await app(scope, receive, checked_send)

    with TestClient(observe) as client:
        assert client.post("/api/auth/signup", json=JANE).status_code == 201
    assert seen == [1]


@pytest.mark.parametrize(
    "overrides",
    [
        {"session_ttl_s": 0},
        {"chat_rate_limit": 0},
        {"chat_rate_window_s": 0},
        {"auth_rate_limit": 0},
        {"auth_rate_window_s": 0},
        {"max_documents_per_user": 0},
    ],
)
def test_account_settings_must_be_positive(overrides: dict) -> None:
    with pytest.raises(ValidationError):
        Settings(**overrides)
