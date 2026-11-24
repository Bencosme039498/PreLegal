"""A user's saved documents (/api/documents): drafts, scoped to the signed-in user."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import PASSWORD, FakeLlm, sign_up

NDA_COMPLETE = {
    "effective_date": "2026-11-24",
    "party_a_name": "Acme Inc",
    "party_a_entity_type": "Delaware corporation",
    "party_a_address": "1 Main St",
    "party_a_signatory_name": "Jane Smith",
    "party_a_signatory_title": "CEO",
    "party_b_name": "Globex LLC",
    "party_b_entity_type": "Texas LLC",
    "party_b_address": "2 Elm St",
    "party_b_signatory_name": "John Doe",
    "party_b_signatory_title": "CTO",
    "purpose": "evaluating a partnership",
    "term_years": "2",
    "confidentiality_period_years": "3",
    "governing_law": "the State of New York",
    "jurisdiction": "New York County, New York",
}
CHAT = [
    {"role": "user", "content": "NDA between Acme Inc and Globex LLC"},
    {"role": "assistant", "content": "Great. When does it start?"},
]


@pytest.fixture(autouse=True)
def _signed_in(client: TestClient) -> None:
    sign_up(client)


def create(client: TestClient, **body) -> dict:
    res = client.post("/api/documents", json={"template_id": "mutual-nda", **body})
    assert res.status_code == 201, res.text
    return res.json()


def test_create_and_get(client: TestClient) -> None:
    doc = create(client, title="NDA: Acme Inc", values={"party_a_name": "Acme Inc"}, messages=CHAT)
    assert doc == {
        "id": doc["id"],
        "template_id": "mutual-nda",
        "title": "NDA: Acme Inc",
        "complete": False,
        "created_at": doc["created_at"],
        "updated_at": doc["created_at"],
        "values": {"party_a_name": "Acme Inc"},
        "messages": CHAT,
    }
    assert client.get(f"/api/documents/{doc['id']}").json() == doc


def test_blank_title_is_the_template_name(client: TestClient) -> None:
    assert create(client)["title"] == "Mutual Non-Disclosure Agreement"
    assert create(client, title="   ")["title"] == "Mutual Non-Disclosure Agreement"


def test_values_are_kept_as_typed_but_unknown_keys_are_dropped(client: TestClient) -> None:
    # An unfinished or invalid value survives (the user is still typing); it just isn't complete.
    values = {"party_a_name": "  Acme ", "term_years": "two", "not_a_field": "x"}
    doc = create(client, values=values)
    assert doc["values"] == {"party_a_name": "  Acme ", "term_years": "two"}


def test_complete_follows_the_chat_rules(client: TestClient) -> None:
    assert create(client, values=NDA_COMPLETE)["complete"] is True
    assert create(client, values={**NDA_COMPLETE, "term_years": "two"})["complete"] is False
    missing = {k: v for k, v in NDA_COMPLETE.items() if k != "governing_law"}
    assert create(client, values=missing)["complete"] is False


def test_update_replaces_the_draft(client: TestClient) -> None:
    doc = create(client, values={"party_a_name": "Acme Inc", "purpose": "x"}, messages=CHAT)
    res = client.put(
        f"/api/documents/{doc['id']}",
        json={"title": "Finished NDA", "values": NDA_COMPLETE, "messages": CHAT[:1]},
    )
    assert res.status_code == 200
    updated = res.json()
    assert updated["title"] == "Finished NDA"
    assert updated["values"] == NDA_COMPLETE
    assert updated["messages"] == CHAT[:1]
    assert updated["complete"] is True
    assert updated["template_id"] == "mutual-nda"
    assert updated["updated_at"] >= doc["updated_at"]
    # Clearing a field persists (a save replaces all the values).
    cleared = client.put(f"/api/documents/{doc['id']}", json={"values": {}}).json()
    assert cleared["values"] == {} and cleared["messages"] == [] and cleared["complete"] is False


def test_list_is_newest_first_without_contents(client: TestClient) -> None:
    first = create(client, title="First")
    second = create(client, title="Second")
    client.put(f"/api/documents/{first['id']}", json={"title": "First, edited"})
    listed = client.get("/api/documents").json()
    assert [d["id"] for d in listed] == [first["id"], second["id"]]
    assert set(listed[0]) == {"id", "template_id", "title", "complete", "created_at", "updated_at"}


def test_delete(client: TestClient) -> None:
    doc = create(client)
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
    res = client.get(f"/api/documents/{doc['id']}")
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "document_not_found"
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 404
    assert client.get("/api/documents").json() == []


def test_documents_are_private_to_their_owner(client: TestClient) -> None:
    doc = create(client, values={"party_a_name": "Acme Inc"})
    sign_up(client, email="mallory@example.com", name="Mallory")
    assert client.get("/api/documents").json() == []
    for res in (
        client.get(f"/api/documents/{doc['id']}"),
        client.put(f"/api/documents/{doc['id']}", json={"values": {}}),
        client.delete(f"/api/documents/{doc['id']}"),
    ):
        assert res.status_code == 404
        assert res.json()["detail"]["code"] == "document_not_found"
    # Jane's document is untouched.
    client.post("/api/auth/login", json={"email": "jane@example.com", "password": PASSWORD})
    assert client.get(f"/api/documents/{doc['id']}").json()["values"] == {"party_a_name": "Acme Inc"}


def test_documents_need_a_signed_in_user(client: TestClient) -> None:
    doc = create(client)
    client.post("/api/auth/logout")
    for res in (
        client.get("/api/documents"),
        client.post("/api/documents", json={"template_id": "mutual-nda"}),
        client.get(f"/api/documents/{doc['id']}"),
        client.put(f"/api/documents/{doc['id']}", json={}),
        client.delete(f"/api/documents/{doc['id']}"),
    ):
        assert res.status_code == 401
        assert res.json()["detail"]["code"] == "not_authenticated"


def test_unknown_template_is_404(client: TestClient) -> None:
    res = client.post("/api/documents", json={"template_id": "lease"})
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "unknown_template"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"template_id": "mutual-nda", "title": "x" * 201},
        {"template_id": "mutual-nda", "values": {"purpose": "x" * 5001}},
        {"template_id": "mutual-nda", "values": {"purpose": 5}},
        {"template_id": "mutual-nda", "messages": [{"role": "system", "content": "hi"}]},
        {"template_id": "mutual-nda", "messages": [{"role": "user", "content": "hi"}] * 201},
    ],
)
def test_invalid_documents_are_422(client: TestClient, body: dict) -> None:
    assert client.post("/api/documents", json=body).status_code == 422


def test_ids_outside_the_integer_range_are_422(client: TestClient) -> None:
    for doc_id in ("abc", "0", str(2**63)):
        assert client.get(f"/api/documents/{doc_id}").status_code == 422


def test_saved_documents_are_capped_per_user(settings: Settings, fake_llm: FakeLlm) -> None:
    db_path = settings.db_path.with_name("capped.db")
    capped = settings.model_copy(update={"max_documents_per_user": 2, "db_path": db_path})
    with TestClient(create_app(capped, llm=fake_llm)) as client:
        sign_up(client)
        create(client)
        create(client)
        res = client.post("/api/documents", json={"template_id": "mutual-nda"})
        assert res.status_code == 409
        assert res.json()["detail"]["code"] == "document_limit"
