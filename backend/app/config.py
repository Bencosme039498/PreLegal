from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> repository root -> data/templates (local runs and tests).
_REPO_TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "data" / "templates"


class Settings(BaseSettings):
    """Backend settings, read from PRELEGAL_* environment variables.

    The OpenAI variables (OPENAI_API_KEY, OPENAI_MODEL) are not settings: LiteLLM and app/llm.py
    read them straight from the environment, as the project's LLM skill does.
    """

    model_config = SettingsConfigDict(env_prefix="PRELEGAL_", extra="ignore", populate_by_name=True)

    # Production database: PostgreSQL (Neon), e.g. postgresql://user:pass@host/db?sslmode=require.
    # Read from DATABASE_URL (or PRELEGAL_DATABASE_URL); a secret, never logged. Unset = SQLite.
    database_url: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("database_url", "DATABASE_URL", "PRELEGAL_DATABASE_URL")
    )
    # Local SQLite database, used when database_url is unset. It persists across restarts; only
    # with db_reset=True (local Docker scripts, tests) is it deleted and recreated on every start.
    db_path: Path = Path("prelegal.db")
    db_reset: bool = False
    # Directory with the frontend's static export (frontend/out). None serves the API only.
    static_dir: Path | None = None
    # Template dataset (catalog.json): the AI chat builds its prompt and output schema from it.
    templates_dir: Path = _REPO_TEMPLATES_DIR
    # LLM calls: per-attempt timeout (seconds) and retries after a failed attempt.
    llm_timeout_s: float = Field(default=20.0, gt=0)
    llm_max_retries: int = Field(default=1, ge=0)
    # Total time for one chat request, which may make two LLM calls (choosing a document, then its
    # first turn). Under 60 s: the frontend waits 110 s, which covers this budget plus up to about a
    # minute of LiteLLM still loading after a cold start (that wait comes before the budget starts),
    # and stays below the Vercel proxy's 120 s limit, so the server's answer always arrives.
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

    @field_validator("database_url")
    @classmethod
    def _postgres_url(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None or not value.get_secret_value().strip():
            return None
        if not value.get_secret_value().startswith(("postgres://", "postgresql://")):
            raise ValueError("DATABASE_URL must be a postgresql:// connection string")
        return value

    @model_validator(mode="after")
    def _reset_only_sqlite(self) -> "Settings":
        # A reset deletes everything: never allowed against the production (PostgreSQL) database.
        if self.db_reset and self.database_url is not None:
            raise ValueError("PRELEGAL_DB_RESET only applies to the local SQLite database, not DATABASE_URL")
        return self
