from typing import Annotated

from pydantic import BaseModel, StringConstraints

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
