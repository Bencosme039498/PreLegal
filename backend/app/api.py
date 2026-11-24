import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from . import db
from .config import Settings
from .schemas import Health, SessionRequest, UserOut

router = APIRouter(prefix="/api")


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(settings: Annotated[Settings, Depends(get_settings)]) -> Iterator[sqlite3.Connection]:
    with db.connect(settings.db_path) as conn:
        yield conn


DbConn = Annotated[sqlite3.Connection, Depends(get_db)]


@router.get("/health")
def health() -> Health:
    return Health(status="ok")


@router.post("/session")
def create_session(body: SessionRequest, conn: DbConn) -> UserOut:
    """Fake sign-in: records the user (by email) and returns them. No authentication."""
    return UserOut.model_validate(dict(db.upsert_user(conn, name=body.name, email=body.email)))


# Registered last: unknown /api/* paths get a JSON 404 instead of the frontend's HTML 404 page.
@router.api_route(
    "/{_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
def api_not_found(_path: str) -> None:
    raise HTTPException(status_code=404, detail="Not found")
