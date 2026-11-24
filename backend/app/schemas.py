from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

# ---- Accounts. Mirrored by validateSignUp / validateSignIn in frontend/src/lib/session.ts; a plain
# email pattern keeps the backend free of the email-validator dependency. ----

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
PASSWORD_MIN = 8
PASSWORD_MAX = 128

Email = Annotated[
    str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254, pattern=EMAIL_PATTERN)
]


class SignUpRequest(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    email: Email
    # Not stripped: a password may contain (or end with) spaces.
    password: Annotated[str, StringConstraints(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)]


class SignInRequest(BaseModel):
    email: Email
    # Any non-empty length up to the maximum: a wrong password is invalid_credentials, not a 422.
    password: Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX)]


class UserOut(BaseModel):
    id: int
    name: str
    email: str


class Health(BaseModel):
    status: str


# ---- AI chat. MAX_MESSAGE_CHARS mirrors frontend/src/lib/chat.ts; MAX_MESSAGES only bounds
# the request size (the chat service sends the model the last chat.MAX_HISTORY messages). ----

MAX_MESSAGE_CHARS = 2000
MAX_MESSAGES = 100

# A document's field values as the client sends them (validated against the template by the server).
FieldValuesIn = Annotated[
    dict[
        Annotated[str, StringConstraints(max_length=100)],
        Annotated[str, StringConstraints(max_length=5000)],
    ],
    Field(max_length=100),
]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_MESSAGE_CHARS)
    ]


class ChatRequest(BaseModel):
    # The document the conversation is about; None (e.g. on the home page) lets the AI choose it.
    template_id: Annotated[str, StringConstraints(max_length=100)] | None = None
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=MAX_MESSAGES)]
    # The document's current field values (validated against the template by the chat service).
    values: FieldValuesIn = {}

    @model_validator(mode="after")
    def _ends_with_user_message(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return self


class ChatResponse(BaseModel):
    reply: str
    # The document the conversation is now about: None while still choosing; when it differs from
    # the request's template_id (chosen or switched), the client opens that document.
    template_id: str | None
    # Every field of template_id that has a valid value (raw text; the frontend escapes it).
    values: dict[str, str]
    # Whether every required field has a value.
    complete: bool


# ---- Saved documents: a user's drafts, with the chat that filled them in ----

MAX_SAVED_MESSAGES = 200


class DocumentContent(BaseModel):
    """A whole draft, as the client saves it (every save replaces all of it)."""

    # Shown in the documents list, e.g. "Mutual NDA: Acme Inc & Globex LLC"; blank = the template name.
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    # Kept as typed, so an unfinished value survives a reload; keys that aren't fields are dropped.
    values: FieldValuesIn = {}
    messages: Annotated[list[ChatMessage], Field(max_length=MAX_SAVED_MESSAGES)] = []


class DocumentCreate(DocumentContent):
    template_id: Annotated[str, StringConstraints(max_length=100)]


class DocumentSummary(BaseModel):
    id: int
    template_id: str
    title: str
    # Whether every required field has a valid value (computed by the server).
    complete: bool
    created_at: str
    updated_at: str


class DocumentOut(DocumentSummary):
    values: dict[str, str]
    messages: list[ChatMessage]
