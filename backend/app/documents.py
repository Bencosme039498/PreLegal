"""A signed-in user's saved documents: drafts the frontend autosaves while they chat or type.

Every route is scoped to the signed-in user; another user's document id is a 404, never a 403.
"""

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path

from . import chat, db
from .auth import CurrentUser
from .deps import Catalog, DbConn, SettingsDep, api_error, unknown_template
from .schemas import DocumentContent, DocumentCreate, DocumentOut, DocumentSummary
from .templates import TemplateDef

router = APIRouter(prefix="/api/documents", tags=["documents"])

# SQLite integer range: a larger id would overflow instead of being "not found".
DocId = Annotated[int, Path(ge=1, le=2**63 - 1)]


def _not_found() -> HTTPException:
    return api_error(404, "document_not_found", "This document doesn't exist or was deleted.")


def _content(template: TemplateDef, body: DocumentContent) -> dict[str, Any]:
    """The stored form of a draft: values kept as typed (only the template's fields) and whether
    every required field is valid, by the same rules as the chat's `complete`."""
    keys = {f.key for f in template.fields}
    values = {k: v for k, v in body.values.items() if k in keys}
    return {
        "title": body.title or template.name,
        "values": values,
        "messages": [m.model_dump() for m in body.messages],
        "complete": not chat.missing_fields(template, chat.clean_values(template, values)),
    }


@router.get("")
def list_documents(user: CurrentUser, conn: DbConn) -> list[DocumentSummary]:
    """The user's documents, most recently edited first (without their contents)."""
    return [DocumentSummary.model_validate(d) for d in db.list_documents(conn, user["id"])]


@router.post("", status_code=201)
def create_document(
    body: DocumentCreate, user: CurrentUser, conn: DbConn, catalog: Catalog, settings: SettingsDep
) -> DocumentOut:
    template = catalog.get(body.template_id)
    if template is None:
        raise unknown_template()
    if db.count_documents(conn, user["id"]) >= settings.max_documents_per_user:
        raise api_error(
            409,
            "document_limit",
            "You've reached the limit of saved documents. Delete some to save new ones.",
        )
    doc = db.create_document(conn, user["id"], template_id=template.id, **_content(template, body))
    return DocumentOut.model_validate(doc)


@router.get("/{doc_id}")
def get_document(doc_id: DocId, user: CurrentUser, conn: DbConn) -> DocumentOut:
    doc = db.get_document(conn, user["id"], doc_id)
    if doc is None:
        raise _not_found()
    return DocumentOut.model_validate(doc)


@router.put("/{doc_id}")
def update_document(
    doc_id: DocId, body: DocumentContent, user: CurrentUser, conn: DbConn, catalog: Catalog
) -> DocumentOut:
    """Replaces the draft's title, values and chat (its template never changes)."""
    existing = db.get_document(conn, user["id"], doc_id)
    if existing is None:
        raise _not_found()
    # Saved with a catalog template, and the catalog only changes with a restart (which empties the database).
    template = catalog[existing["template_id"]]
    doc = db.update_document(conn, user["id"], doc_id, **_content(template, body))
    return DocumentOut.model_validate(doc)


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: DocId, user: CurrentUser, conn: DbConn) -> None:
    if not db.delete_document(conn, user["id"], doc_id):
        raise _not_found()
