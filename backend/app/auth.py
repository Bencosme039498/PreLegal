"""Accounts: sign up, sign in, sign out, and the signed-in user for other routes.

Passwords are hashed with scrypt (stdlib). A sign-in creates a session: the browser keeps a random
token in an HttpOnly cookie and the database keeps only its SHA-256, so a leaked database can't be
replayed as cookies. Sessions live in the temporary database, so a restart signs everyone out.
"""

import base64
import hashlib
import hmac
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from . import db
from .config import Settings
from .deps import AuthLimiter, Clock, DbConn, SettingsDep, api_error
from .ratelimit import RateLimiter, retry_after_header
from .schemas import SignInRequest, SignUpRequest, UserOut

COOKIE_NAME = "prelegal_session"

# scrypt cost (RFC 7914 interactive parameters: about 16 MB and a few tens of ms per hash).
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=_SCRYPT_MAXMEM, dklen=32)


def hash_password(password: str) -> str:
    """'scrypt$n$r$p$salt$hash' (base64), so the parameters can change without breaking old hashes."""
    salt = secrets.token_bytes(16)
    digest = _scrypt(password, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        actual = _scrypt(password, base64.b64decode(salt), int(n), int(r), int(p))
        return hmac.compare_digest(actual, base64.b64decode(digest))
    except ValueError:
        return False


# Checked when the email is unknown, so a sign-in takes as long whether or not the account exists.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


# ---- The signed-in user, for any route ----


def _unauthenticated() -> HTTPException:
    return api_error(401, "not_authenticated", "Your session has ended. Sign in again to continue.")


def current_user(request: Request, conn: DbConn, clock: Clock) -> db.Row:
    """The user whose session cookie came with the request, or a 401 not_authenticated."""
    token = request.cookies.get(COOKIE_NAME)
    if not token or not token.isascii():
        raise _unauthenticated()
    user = db.get_session_user(conn, token_hash=hash_token(token), now=clock())
    if user is None:
        raise _unauthenticated()
    return user


CurrentUser = Annotated[db.Row, Depends(current_user)]


# ---- Routes ----

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(user: db.Row) -> UserOut:
    """The public fields of a user row (never its password hash)."""
    return UserOut(id=user["id"], name=user["name"], email=user["email"])


def _client_key(action: str, request: Request) -> str:
    # Behind a reverse proxy this is the proxy's address; the app is served directly for now.
    return f"{action}:ip:{request.client.host if request.client else 'unknown'}"


def _check_limits(limiter: RateLimiter, *keys: str) -> None:
    waits = [w for w in (limiter.blocked(k) for k in keys) if w is not None]
    if waits:
        raise api_error(
            429,
            "too_many_attempts",
            "Too many attempts. Wait a few minutes and try again.",
            retryable=True,
            headers=retry_after_header(max(waits)),
        )


def _start_session(response: Response, conn: db.Conn, settings: Settings, now: float, user_id: int) -> None:
    token = secrets.token_urlsafe(32)
    db.create_session(
        conn, token_hash=hash_token(token), user_id=user_id, expires_at=now + settings.session_ttl_s, now=now
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=int(settings.session_ttl_s),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/signup", status_code=201)
def sign_up(
    body: SignUpRequest,
    request: Request,
    response: Response,
    conn: DbConn,
    settings: SettingsDep,
    clock: Clock,
    limiter: AuthLimiter,
) -> UserOut:
    """Creates an account and signs it in. 409 email_taken if the email is registered."""
    client = _client_key("signup", request)
    _check_limits(limiter, client)
    limiter.hit(client)  # every sign-up counts: it bounds account creation per address
    user = db.create_user(conn, name=body.name, email=body.email, password_hash=hash_password(body.password))
    if user is None:
        raise api_error(409, "email_taken", "An account with this email already exists. Sign in instead.")
    _start_session(response, conn, settings, clock(), user["id"])
    return _user_out(user)


@router.post("/login")
def sign_in(
    body: SignInRequest,
    request: Request,
    response: Response,
    conn: DbConn,
    settings: SettingsDep,
    clock: Clock,
    limiter: AuthLimiter,
) -> UserOut:
    """Signs in. A wrong password and an unknown email give the same 401 invalid_credentials."""
    keys = (_client_key("login", request), f"login:email:{body.email}")
    _check_limits(limiter, *keys)
    user = db.get_user_by_email(conn, body.email)
    valid = verify_password(body.password, user["password_hash"] if user else _DUMMY_HASH)
    if user is None or not valid:
        for key in keys:  # only failures count, so a user who signs in often is never locked out
            limiter.hit(key)
        raise api_error(401, "invalid_credentials", "The email or password is incorrect.")
    limiter.reset(keys[1])
    _start_session(response, conn, settings, clock(), user["id"])
    return _user_out(user)


@router.post("/logout", status_code=204)
def sign_out(request: Request, response: Response, conn: DbConn, settings: SettingsDep) -> None:
    """Ends the session (if any) and clears the cookie. Always succeeds."""
    token = request.cookies.get(COOKIE_NAME)
    if token and token.isascii():
        db.delete_session(conn, hash_token(token))
    response.delete_cookie(
        COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure
    )


@router.get("/me")
def me(user: CurrentUser) -> UserOut:
    """The signed-in user, or 401 not_authenticated."""
    return _user_out(user)
