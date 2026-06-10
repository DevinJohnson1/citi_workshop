"""budget-service — singular per-project budget on ``projects.budget_amount``.

Earlier versions of this service maintained a separate ``budget_plans`` +
``budget_entries`` pair so a project could be broken down into multiple
categories with append-only spend entries. That model has been collapsed:
each project now carries one budget ceiling
(``projects.budget_amount`` + ``projects.budget_currency``) and the only
thing that draws against it is the ``cost`` of equipment (tangibles /
intangibles) assigned to the project. The equipment-service enforces the
ceiling on create / patch — this service only reads/writes the ceiling and
returns the live ``amount_consumed`` rollup.

Routes (relative to ``/api/budget-service``)::

    GET    /?project_id=…   → {project_id, budget_amount, budget_currency,
                                amount_consumed, remaining, charges:[…]}
    PUT    /                 set/update the project's budget
    DELETE /?project_id=…    clear the project's budget (admin only)
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Mapping

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.validation import StrictModel, first_error

_LOG = logging.getLogger()
_SERVICE = "budget-service"


class BudgetUpsert(StrictModel):
    """Body for ``PUT /api/budget-service``.

    ``budget_amount`` may be omitted/null to clear the ceiling, but the
    explicit DELETE endpoint is the preferred way to do that.
    """

    project_id: str
    budget_amount: Decimal | None = Field(default=None, ge=Decimal("0"))
    budget_currency: str = Field(default="USD", min_length=3, max_length=3)


def handler(event: Mapping[str, Any], context: Any = None) -> dict[str, Any]:
    """Lambda entrypoint."""
    if http.is_options(event):
        return http.no_content(event)
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "GET").upper()
    parts = http.path_parts(event, _SERVICE)
    try:
        if method == "GET" and parts == ["health"]:
            return http.ok({"status": "UP", "db": "UP" if db.health() else "DOWN"}, event)
        if method == "GET" and not parts:
            verify_token(event)
            return _get_budget(event)
        if method == "PUT" and not parts:
            return _upsert_budget(event)
        if method == "DELETE" and not parts:
            return _clear_budget(event)
        return http.not_found(event=event)
    except AuthError as exc:
        return handle_auth_errors(event, exc)
    except ValidationError as exc:
        return http.bad_request(first_error(exc), event)
    except ValueError as exc:
        return http.bad_request(str(exc), event)
    except Exception:  # noqa: BLE001
        _LOG.exception("Unhandled error in %s", _SERVICE)
        db.reset_conn()
        return http.error(event=event)


# ── helpers ────────────────────────────────────────────────────────────────

def _project(conn, project_id: str) -> dict[str, Any] | None:
    """Return the project's id/owner/budget fields, or None if missing."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, owner_id, budget_amount, budget_currency "
            "FROM projects WHERE id = %s",
            (project_id,),
        )
        return cur.fetchone()


def _charges(conn, project_id: str) -> list[dict[str, Any]]:
    """Equipment rows currently assigned to the project.

    Rejected rows are excluded — they never draw against the budget. Pending
    rows *are* included because reserving budget while approval is in flight
    is the whole point of the gate (avoids two leads approving items that
    individually fit but together overflow). Rows with NULL ``cost`` are
    included too so the user can see them in the per-project Budget tab
    (they contribute 0 to ``amount_consumed`` — the SUM ignores NULLs).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, kind, is_tangible, cost, currency,
                   status, approval_status
            FROM equipment
            WHERE assigned_project_id = %s
              AND approval_status IN ('approved', 'pending')
            ORDER BY is_tangible DESC, name
            """,
            (project_id,),
        )
        return list(cur.fetchall())


def _budget_payload(project: dict[str, Any], charges: list[dict[str, Any]]) -> dict[str, Any]:
    """Pack the projection returned by GET and after PUT."""
    consumed = sum(
        (Decimal(c["cost"]) for c in charges if c["cost"] is not None),
        start=Decimal("0"),
    )
    planned = project["budget_amount"]
    remaining: Decimal | None = (
        Decimal(planned) - consumed if planned is not None else None
    )
    return {
        "project_id": project["id"],
        "budget_amount": planned,
        "budget_currency": project["budget_currency"],
        "amount_consumed": consumed,
        "remaining": remaining,
        "charges": charges,
    }


def _require_owner_or_admin(user: Mapping[str, Any], owner_id: str) -> None:
    """Match projects-service: admin OR the owning team_lead may write."""
    if user["role"] == "admin":
        return
    if user["role"] == "team_lead" and owner_id == user["id"]:
        return
    raise AuthError(403, "Insufficient role")


# ── handlers ───────────────────────────────────────────────────────────────

def _get_budget(event: Mapping[str, Any]) -> dict[str, Any]:
    qs = http.query_params(event)
    project_id = qs.get("project_id")
    if not project_id:
        raise ValueError("project_id: query parameter is required")
    conn = db.get_conn()
    project = _project(conn, project_id)
    if project is None:
        return http.not_found("Project not found", event)
    charges = _charges(conn, project_id)
    return http.ok(_budget_payload(project, charges), event)


def _upsert_budget(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    body = BudgetUpsert(**http.parse_json_body(event))
    conn = db.get_conn()
    project = _project(conn, body.project_id)
    if project is None:
        return http.not_found("Project not found", event)
    _require_owner_or_admin(user, project["owner_id"])

    # Refuse to lower the ceiling below what's already committed to assigned
    # equipment — otherwise existing tangibles would be silently underwater.
    if body.budget_amount is not None:
        committed_charges = _charges(conn, body.project_id)
        committed = sum(
            (Decimal(c["cost"]) for c in committed_charges if c["cost"] is not None),
            start=Decimal("0"),
        )
        if body.budget_amount < committed:
            raise ValueError(
                f"budget_amount: cannot be lower than already committed equipment "
                f"costs ({committed} {body.budget_currency.upper()})"
            )

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE projects "
            "SET budget_amount = %s, budget_currency = %s "
            "WHERE id = %s "
            "RETURNING id, owner_id, budget_amount, budget_currency",
            (body.budget_amount, body.budget_currency.upper(), body.project_id),
        )
        updated = cur.fetchone()
        db.audit(
            conn, user["id"], "project_budget.updated", "project", body.project_id,
            {
                "budget_amount": str(body.budget_amount) if body.budget_amount is not None else None,
                "budget_currency": body.budget_currency.upper(),
            },
        )
    charges = _charges(db.get_conn(), body.project_id)
    return http.ok(_budget_payload(updated, charges), event)


def _clear_budget(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    qs = http.query_params(event)
    project_id = qs.get("project_id")
    if not project_id:
        raise ValueError("project_id: query parameter is required")
    conn = db.get_conn()
    project = _project(conn, project_id)
    if project is None:
        return http.not_found("Project not found", event)
    # Clearing the ceiling is admin-only — it disables the budget gate for
    # the project entirely, and we don't want a single team_lead doing that.
    if user["role"] != "admin":
        raise AuthError(403, "Insufficient role")
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("UPDATE projects SET budget_amount = NULL WHERE id = %s", (project_id,))
        db.audit(conn, user["id"], "project_budget.cleared", "project", project_id, None)
    return http.no_content(event)


