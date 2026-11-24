from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend settings, read from PRELEGAL_* environment variables.

    Other variables in the shared .env (e.g. OPENAI_API_KEY for PL-7) are ignored here.
    """

    model_config = SettingsConfigDict(env_prefix="PRELEGAL_", extra="ignore")

    # Temporary database: deleted and recreated every time the app starts.
    db_path: Path = Path("prelegal.db")
    # Directory with the frontend's static export (frontend/out). None serves the API only.
    static_dir: Path | None = None
