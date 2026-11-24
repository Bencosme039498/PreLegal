from pathlib import Path

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
    # LLM calls: per-attempt timeout (seconds) and retries done by the OpenAI client.
    llm_timeout_s: float = 20.0
    llm_max_retries: int = 1
