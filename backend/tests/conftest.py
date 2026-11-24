from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

# A miniature Next.js static export (trailingSlash: true layout).
FAKE_EXPORT = {
    "index.html": "<h1>home</h1>",
    "login/index.html": "<h1>login</h1>",
    "templates/mutual-nda/index.html": "<h1>mutual nda</h1>",
    "404.html": "<h1>custom not found</h1>",
    "_next/static/chunks/app.js": "console.log('app')",
}


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    root = tmp_path / "out"
    for rel, content in FAKE_EXPORT.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(content, encoding="utf-8")
    return root


@pytest.fixture
def settings(tmp_path: Path, static_dir: Path) -> Settings:
    return Settings(db_path=tmp_path / "data" / "prelegal.db", static_dir=static_dir)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    # The context manager runs the lifespan, which creates the database.
    with TestClient(create_app(settings)) as c:
        yield c
