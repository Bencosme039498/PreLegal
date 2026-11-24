from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> repository root -> data/templates (local runs and tests).
_REPO_TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "data" / "templates"


class Settings(BaseSettings):
    """Backend settings, read from PRELEGAL_* environment variables.

    The OpenAI variables (OPENAI_API_KEY, OPENAI_MODEL) are not settings: LiteLLM and app/llm.py
    read them straight from the environment, as the project's LLM skill does.
    """

    model_config = SettingsConfigDict(env_prefix="PRELEGAL_", extra="ignore")

    # Temporary database: deleted and recreated every time the app starts.
    db_path: Path = Path("prelegal.db")
    # Directory with the frontend's static export (frontend/out). None serves the API only.
    static_dir: Path | None = None
    # Template dataset (catalog.json): the AI chat builds its prompt and output schema from it.
    templates_dir: Path = _REPO_TEMPLATES_DIR
    # LLM calls: per-attempt timeout (seconds) and retries after a failed attempt.
    llm_timeout_s: float = Field(default=20.0, gt=0)
    llm_max_retries: int = Field(default=1, ge=0)
    # Total time for one chat request, which may make two LLM calls (choosing a document, then its
    # first turn). Stays below the frontend's 60 s timeout so the server's answer always arrives.
    chat_budget_s: float = Field(default=50.0, gt=0, lt=60)

    # Accounts: how long a sign-in lasts, and whether the session cookie is HTTPS-only (set true
    # when serving over HTTPS; the Docker scripts serve plain http://localhost).
    session_ttl_s: float = Field(default=14 * 24 * 3600, gt=0)
    cookie_secure: bool = False
    # Rate limits (in memory, per process): AI chat turns per user, and failed sign-ins or sign-ups
    # per email and per client address, each within a sliding window.
    chat_rate_limit: int = Field(default=30, ge=1)
    chat_rate_window_s: float = Field(default=60.0, gt=0)
    auth_rate_limit: int = Field(default=10, ge=1)
    auth_rate_window_s: float = Field(default=300.0, gt=0)
    # Saved drafts per user.
    max_documents_per_user: int = Field(default=200, ge=1)
