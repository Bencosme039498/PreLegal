from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_OUT = REPO_ROOT / "frontend" / "out"


def test_serves_index(client: TestClient) -> None:
    res = client.get("/")
    assert res.status_code == 200
    assert "home" in res.text
    assert res.headers["content-type"].startswith("text/html")


def test_serves_nested_routes_with_trailing_slash(client: TestClient) -> None:
    assert "login" in client.get("/login/").text
    assert "mutual nda" in client.get("/templates/mutual-nda/").text


def test_redirects_routes_without_trailing_slash(client: TestClient) -> None:
    res = client.get("/login", follow_redirects=False)
    assert res.status_code in (301, 307, 308)
    assert res.headers["location"].endswith("/login/")
    assert "login" in client.get("/login").text


def test_serves_static_assets(client: TestClient) -> None:
    res = client.get("/_next/static/chunks/app.js")
    assert res.status_code == 200
    assert "console.log" in res.text


def test_unknown_page_serves_custom_404(client: TestClient) -> None:
    res = client.get("/no-such-page/")
    assert res.status_code == 404
    assert "custom not found" in res.text


def test_path_traversal_is_blocked(client: TestClient, static_dir: Path) -> None:
    (static_dir.parent / "secret.txt").write_text("top secret", encoding="utf-8")
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/templates/..%2f..%2fsecret.txt"):
        res = client.get(path)
        assert res.status_code == 404, path
        assert "top secret" not in res.text


@pytest.mark.parametrize("static_dir_name", [None, "missing"])
def test_api_only_without_frontend_build(tmp_path: Path, static_dir_name: str | None) -> None:
    static_dir = tmp_path / static_dir_name if static_dir_name else None
    settings = Settings(db_path=tmp_path / "prelegal.db", static_dir=static_dir)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 404


@pytest.mark.skipif(not FRONTEND_OUT.is_dir(), reason="run `npm run build` in frontend/ first")
def test_serves_real_frontend_export(tmp_path: Path) -> None:
    """Integration: the backend serves the actual Next.js export (all catalog templates)."""
    settings = Settings(db_path=tmp_path / "prelegal.db", static_dir=FRONTEND_OUT)
    with TestClient(create_app(settings)) as client:
        assert "PreLegal" in client.get("/").text
        assert client.get("/login/").status_code == 200
        for page in (FRONTEND_OUT / "templates").iterdir():
            assert client.get(f"/templates/{page.name}/").status_code == 200, page.name
        not_found = client.get("/templates/no-such-template/")
        assert not_found.status_code == 404
        assert "Page not found" in not_found.text
