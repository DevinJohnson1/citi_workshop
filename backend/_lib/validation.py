"""Pydantic base model + helpers shared by every service."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError


class StrictModel(BaseModel):
    """Pydantic v2 base with ``extra='forbid'`` so unknown fields raise."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# Enum aliases that mirror the CHECK constraints in ``_db/migrations/001_init.sql``.
# Services should import these instead of re-declaring ``str`` plus a hand-rolled
# allow-list set; pydantic then rejects bad values at parse time with a
# consistent ``"<field>: Input should be 'planned', 'active', ..."`` message,
# and the per-handler ``if value not in _ALLOWED`` re-checks can disappear.
ProjectStatus = Literal["planned", "active", "on_hold", "done", "cancelled"]
DeliverableStatus = Literal["todo", "in_progress", "blocked", "done", "cancelled"]
AssignmentRole = Literal["owner", "contributor", "reviewer"]
UserRole = Literal["admin", "team_lead", "team_member", "viewer"]


def first_error(exc: ValidationError) -> str:
    """Return ``"<field>: <message>"`` for the first validation error."""
    err = exc.errors()[0]
    loc = ".".join(str(p) for p in err.get("loc", ())) or "body"
    msg = err.get("msg", "invalid")
    return f"{loc}: {msg}"

