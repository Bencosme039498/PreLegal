"""The template catalog (data/templates/catalog.json): field definitions for each template."""

import json
import re
from pathlib import Path

from pydantic import BaseModel, ConfigDict, field_validator

_PLACEHOLDER = re.compile(r"\{\{\s*([a-z][a-z0-9_]*)\s*\}\}")
# How much of the sentence around a placeholder to keep as context for the AI.
_USAGE_BEFORE = 60
_USAGE_AFTER = 40


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
    # Where the value lands in the document, e.g. 'a ___ with its principal address at': derived
    # from the template body (not in catalog.json) so the AI can phrase the value to fit.
    usage: str | None = None

    @field_validator("default", mode="before")
    @classmethod
    def _stringify_default(cls, value: object) -> str | None:
        # The catalog writes e.g. `"default": 2`; field values are always strings.
        return None if value is None else str(value)


class TemplateDef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")

    id: str
    name: str
    category: str
    description: str
    file: str
    fields: tuple[FieldDef, ...]


def field_usages(body: str) -> dict[str, str]:
    """Each placeholder's first appearance in the template, with the placeholder shown as ___.

    E.g. 'a ___ with its principal address at ...'. A placeholder alone on its line (a block of
    free text) has no surrounding sentence and gets no entry.
    """
    usages: dict[str, str] = {}
    for line in body.splitlines():
        for match in _PLACEHOLDER.finditer(line):
            key = match.group(1)
            if key in usages:
                continue
            before = _PLACEHOLDER.sub("...", line[: match.start()])[-_USAGE_BEFORE:]
            after = _PLACEHOLDER.sub("...", line[match.end() :])[:_USAGE_AFTER]
            text = (before + "___" + after).replace("**", "").strip(" |#>-*")
            if text != "___":
                usages[key] = text
    return usages


def load_catalog(templates_dir: Path) -> dict[str, TemplateDef]:
    """All templates by id. Raises if catalog.json or a template file is missing or malformed."""
    raw = json.loads((templates_dir / "catalog.json").read_text(encoding="utf-8"))
    catalog: dict[str, TemplateDef] = {}
    for entry in raw["templates"]:
        template = TemplateDef.model_validate(entry)
        usages = field_usages((templates_dir / template.file).read_text(encoding="utf-8"))
        fields = tuple(f.model_copy(update={"usage": usages.get(f.key)}) for f in template.fields)
        catalog[template.id] = template.model_copy(update={"fields": fields})
    return catalog
