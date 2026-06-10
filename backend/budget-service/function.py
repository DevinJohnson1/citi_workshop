"""budget-service — immutable ``budget_plans`` + append-only ``budget_entries``.

Routes (relative to ``/api/budget-service``)::

    GET    /                              ?project_id=  → plans + amount_consumed
    POST   /                              create plan
    DELETE /{plan_id}                     admin only, cascades entries
    GET    /{plan_id}/entries             list entries
    POST   /{plan_id}/entries             append entry
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
_LOG.setLevel(logging.INFO)
_SERVICE = "budget-service"


class PlanCreate(StrictModel):
    """Body for ``POST /api/budget-service``."""

    project_id: str
    category: str = Field(min_length=1, max_length=80)
    amount_planned: Decimal = Field(ge=Decimal("0"))
    currency: str = Field(default="USD", min_length=3, max_length=3)


class EntryCreate(StrictModel):
    """Body for ``POST /api/budget-service/{plan_id}/entries``."""

    amount: Decimal = Field(ge=Decimal("0"))
    description: str = ""


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
            return _list_plans(event)
        if method == "POST" and not parts:
            return _create_plan(event)
        if method == "DELETE" and len(parts) == 1:
            return _delete_plan(event, parts[0])
        if method == "GET" and len(parts) == 2 and parts[1] == "entries":
            verify_token(event)
            return _list_entries(event, parts[0])
        if method == "POST" and len(parts) == 2 and parts[1] == "entries":
            return _create_entry(event, parts[0])
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


def _list_plans(event: Mapping[str, Any]) -> dict[str, Any]:
    qs = http.query_params(event)
    where = ""
    params: list[Any] = []
    if pid := qs.get("project_id"):
        where = "WHERE bp.project_id = %s"
        params.append(pid)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT bp.*,
                   COALESCE(SUM(be.amount), 0)::numeric(14,2) AS amount_consumed
            FROM budget_plans bp
            LEFT JOIN budget_entries be ON be.budget_plan_id = bp.id
            {where}
            GROUP BY bp.id
            ORDER BY bp.created_at DESC
            """,
            params,
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": len(rows), "limit": len(rows), "offset": 0}}, event)


def _project_owner(conn, project_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
    return row["owner_id"] if row else None


def _create_plan(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    body = PlanCreate(**http.parse_json_body(event))
    conn = db.get_conn()
    owner = _project_owner(conn, body.project_id)
    if owner is None:
        return http.not_found("Project not found", event)
    if user["role"] != "admin" and not (user["role"] == "team_lead" and owner == user["id"]):
        raise AuthError(403, "Insufficient role")
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO budget_plans (project_id, category, amount_planned, currency, created_by)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (body.project_id, body.category, body.amount_planned, body.currency.upper(), user["id"]),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "budget_plan.created", "budget_plan", row["id"],
                 {"project_id": body.project_id, "category": body.category})
    return http.created(row, event)


def _delete_plan(event: Mapping[str, Any], plan_id: str) -> dict[str, Any]:
    user = current_user(event)
    if user["role"] != "admin":
        raise AuthError(403, "Insufficient role")
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM budget_plans WHERE id = %s RETURNING id", (plan_id,))
        if not cur.fetchone():
            return http.not_found(event=event)
        db.audit(conn, user["id"], "budget_plan.deleted", "budget_plan", plan_id, None)
    return http.no_content(event)


def _list_entries(event: Mapping[str, Any], plan_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM budget_entries WHERE budget_plan_id = %s "
            "ORDER BY recorded_at DESC, created_at DESC",
            (plan_id,),
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": len(rows), "limit": len(rows), "offset": 0}}, event)


def _create_entry(event: Mapping[str, Any], plan_id: str) -> dict[str, Any]:
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT bp.id, p.owner_id FROM budget_plans bp "
            "JOIN projects p ON p.id = bp.project_id WHERE bp.id = %s",
            (plan_id,),
        )
        plan = cur.fetchone()
    if not plan:
        return http.not_found("Budget plan not found", event)
    if user["role"] != "admin" and not (user["role"] == "team_lead" and plan["owner_id"] == user["id"]):
        raise AuthError(403, "Insufficient role")
    body = EntryCreate(**http.parse_json_body(event))
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO budget_entries (budget_plan_id, amount, description, recorded_by)
            VALUES (%s, %s, %s, %s)
            RETURNING *
            """,
            (plan_id, body.amount, body.description, user["id"]),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "budget_entry.recorded", "budget_entry", row["id"],
                 {"budget_plan_id": plan_id, "amount": str(body.amount)})
    return http.created(row, event)

