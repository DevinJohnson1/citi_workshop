"""assignments-service — many-to-many between ``deliverables`` and ``users``.

Same row shape for team leads and team members; ``role_on_assignment``
differentiates ``owner`` / ``contributor`` / ``reviewer``. Only users whose
``users.role = 'team_lead'`` may hold ``role_on_assignment = 'owner'`` —
enforced here.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Mapping, get_args

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.validation import AssignmentRole, StrictModel, first_error

_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)
_SERVICE = "assignments-service"
_ROLES: frozenset[str] = frozenset(get_args(AssignmentRole))


class AssignmentCreate(StrictModel):
    """Body for ``POST /api/assignments-service``."""

    deliverable_id: str
    user_id: str
    role_on_assignment: AssignmentRole
    percent: int = Field(default=100, ge=1, le=100)


class AssignmentPatch(StrictModel):
    """Body for ``PATCH /api/assignments-service/{id}``."""

    role_on_assignment: AssignmentRole | None = None
    percent: int | None = Field(default=None, ge=1, le=100)
    accepted_at: datetime | None = None
    completed_at: datetime | None = None


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
            return _list(event)
        if method == "GET" and len(parts) == 1:
            verify_token(event)
            return _get(event, parts[0])
        if method == "POST" and not parts:
            return _create(event)
        if method == "PATCH" and len(parts) == 1:
            return _patch(event, parts[0])
        if method == "DELETE" and len(parts) == 1:
            return _delete(event, parts[0])
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


def _list(event: Mapping[str, Any]) -> dict[str, Any]:
    qs = http.query_params(event)
    where: list[str] = []
    params: list[Any] = []
    if did := qs.get("deliverable_id"):
        where.append("deliverable_id = %s"); params.append(did)
    if uid := qs.get("user_id"):
        where.append("user_id = %s"); params.append(uid)
    if role := qs.get("role_on_assignment"):
        if role not in _ROLES:
            raise ValueError(f"role_on_assignment: must be one of {sorted(_ROLES)}")
        where.append("role_on_assignment = %s"); params.append(role)
    if qs.get("open") == "true":
        where.append("completed_at IS NULL")
    limit = min(int(qs.get("limit", 20) or 20), 100)
    offset = max(int(qs.get("offset", 0) or 0), 0)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM assignments {where_sql}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT * FROM assignments {where_sql} "
            f"ORDER BY assigned_at DESC LIMIT %s OFFSET %s",
            (*params, limit, offset),
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], assignment_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM assignments WHERE id = %s", (assignment_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(row, event)


def _owning_lead_for_deliverable(conn, deliverable_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT p.owner_id FROM deliverables d JOIN projects p ON p.id = d.project_id "
            "WHERE d.id = %s",
            (deliverable_id,),
        )
        row = cur.fetchone()
    return row["owner_id"] if row else None


def _create(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    body = AssignmentCreate(**http.parse_json_body(event))

    conn = db.get_conn()
    owner = _owning_lead_for_deliverable(conn, body.deliverable_id)
    if owner is None:
        return http.not_found("Deliverable not found", event)
    if user["role"] != "admin" and not (user["role"] == "team_lead" and owner == user["id"]):
        raise AuthError(403, "Insufficient role")

    # Only team_lead users may be assigned as 'owner'.
    if body.role_on_assignment == "owner":
        with conn.cursor() as cur:
            cur.execute("SELECT role FROM users WHERE id = %s", (body.user_id,))
            target = cur.fetchone()
        if not target or target["role"] != "team_lead":
            raise AuthError(403, "Only team_lead users may hold role_on_assignment='owner'")

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO assignments
                (deliverable_id, user_id, role_on_assignment, percent, assigned_by)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (body.deliverable_id, body.user_id, body.role_on_assignment, body.percent, user["id"]),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "assignment.created", "assignment", row["id"],
                 {"deliverable_id": body.deliverable_id, "user_id": body.user_id})
    return http.created(row, event)


def _patch(event: Mapping[str, Any], assignment_id: str) -> dict[str, Any]:
    user = current_user(event)
    body = AssignmentPatch(**http.parse_json_body(event))
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ValueError("body: at least one field is required")

    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT a.*, p.owner_id FROM assignments a "
            "JOIN deliverables d ON d.id = a.deliverable_id "
            "JOIN projects p ON p.id = d.project_id WHERE a.id = %s",
            (assignment_id,),
        )
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)

    # Assignee may only touch accepted_at / completed_at.
    assignee_only = {"accepted_at", "completed_at"}
    is_assignee = existing["user_id"] == user["id"]
    is_lead = user["role"] == "admin" or (user["role"] == "team_lead" and existing["owner_id"] == user["id"])
    if is_assignee and not is_lead and not set(fields).issubset(assignee_only):
        raise AuthError(403, "Assignees may only update accepted_at / completed_at")
    if not is_assignee and not is_lead:
        raise AuthError(403, "Insufficient role")


    set_sql = ", ".join(f"{k} = %s" for k in fields)
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE assignments SET {set_sql} WHERE id = %s RETURNING *",
            (*fields.values(), assignment_id),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "assignment.updated", "assignment", assignment_id, fields)
    return http.ok(row, event)


def _delete(event: Mapping[str, Any], assignment_id: str) -> dict[str, Any]:
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT p.owner_id FROM assignments a "
            "JOIN deliverables d ON d.id = a.deliverable_id "
            "JOIN projects p ON p.id = d.project_id WHERE a.id = %s",
            (assignment_id,),
        )
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    if user["role"] != "admin" and not (user["role"] == "team_lead" and existing["owner_id"] == user["id"]):
        raise AuthError(403, "Insufficient role")
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM assignments WHERE id = %s", (assignment_id,))
        db.audit(conn, user["id"], "assignment.deleted", "assignment", assignment_id, None)
    return http.no_content(event)

