from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

# Mirrored by validateLogin in frontend/src/lib/session.ts. A plain pattern keeps the fake
# sign-in free of the email-validator dependency; PL-9 (real auth) can tighten it.
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class SessionRequest(BaseModel):
    """Fake sign-in (PL-6): identifies the user, no password or authentication."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    email: Annotated[
        str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254, pattern=EMAIL_PATTERN)
    ]


class UserOut(BaseModel):
    id: int
    name: str
    email: str


class Health(BaseModel):
    status: str


# ---- AI chat (PL-7). MAX_MESSAGE_CHARS mirrors frontend/src/lib/chat.ts; MAX_MESSAGES only bounds
# the request size (the chat service sends the model the last chat.MAX_HISTORY messages). ----

MAX_MESSAGE_CHARS = 2000
MAX_MESSAGES = 100


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_MESSAGE_CHARS)
    ]


class ChatRequest(BaseModel):
    template_id: Annotated[str, StringConstraints(max_length=100)]
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=MAX_MESSAGES)]
    # The document's current field values (validated against the template by the chat service).
    values: Annotated[
        dict[
            Annotated[str, StringConstraints(max_length=100)],
            Annotated[str, StringConstraints(max_length=5000)],
        ],
        Field(max_length=100),
    ] = {}

    @model_validator(mode="after")
    def _ends_with_user_message(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return self


class ChatResponse(BaseModel):
    reply: str
    # Every field that has a valid value after this turn (raw text; the frontend escapes it).
    values: dict[str, str]
    # Whether every required field has a value.
    complete: bool
