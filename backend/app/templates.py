"""The template catalog (data/templates/catalog.json): field definitions for each template."""

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, field_validator


class FieldDef(BaseModel):
    """A template field, as declared in catalog.json (see catalog.schema.json)."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    key: str
    label: str
    type: str
    required: bool
    default: str | None = None
    example: str | None = None
    options: tuple[str, ...] = ()

    @field_validator("default", mode="before")
    @classmethod
    def _stringify_default(cls, value: object) -> str | None:
        # The catalog writes e.g. `"default": 2`; field values are always strings.
        return None if value is None else str(value)


class TemplateDef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")

    id: str
    name: str
    description: str
    fields: tuple[FieldDef, ...]


def load_catalog(templates_dir: Path) -> dict[str, TemplateDef]:
    """All templates by id. Raises if catalog.json is missing or malformed (fail fast at startup)."""
    raw = json.loads((templates_dir / "catalog.json").read_text(encoding="utf-8"))
    templates = [TemplateDef.model_validate(entry) for entry in raw["templates"]]
    return {t.id: t for t in templates}
