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
