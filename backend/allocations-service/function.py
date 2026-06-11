"""allocations-service — CRUD on project-level capacity (``allocations``).

Allocations carry a free-text ``role_description`` (e.g. "Backend lead",
"QA reviewer") plus a date window. Migration 005 dropped the legacy
``percent`` column; capacity is no longer tracked numerically here. The
reports-service exposes overlap counts derived from the date windows
alone.

Approval workflow (added in migration 003): rows carry an
``approval_status`` of ``pending``/``approved``/``rejected``. Allocations
created by admin or the owning team_lead default to ``approved``; allocations
created by a team_member (self-allocation only) are forced to ``pending``
until an admin or owning team_lead PATCHes the status.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Literal, Mapping

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.projects import is_project_lead
from _lib.validation import StrictModel, first_error

_LOG = logging.getLogger()
_SERVICE = "allocations-service"

ApprovalStatus = Literal["pending", "approved", "rejected"]


class AllocationCreate(StrictModel):
    """Body for ``POST /api/allocations-service``.

    ``user_id`` is optional for team_member self-requests — when omitted the
    backend fills it with the caller's id. Leads/admins must always supply it.
    """

    user_id: str | None = None
    project_id: str
    role_description: str = Field(default="", max_length=500)
    start_date: date
    end_date: date


class AllocationPatch(StrictModel):
    """Body for ``PATCH /api/allocations-service/{id}``."""

    role_description: str | None = Field(default=None, max_length=500)
    start_date: date | None = None
    end_date: date | None = None
    approval_status: ApprovalStatus | None = None


_PROJECTION = (
    "id, user_id, project_id, role_description, start_date, end_date, created_at, "
    "approval_status, requested_by, approved_by, approved_at"
)


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
    if uid := qs.get("user_id"):
        where.append("user_id = %s"); params.append(uid)
    if pid := qs.get("project_id"):
        where.append("project_id = %s"); params.append(pid)
    if status := qs.get("approval_status"):
        where.append("approval_status = %s"); params.append(status)
    limit = min(int(qs.get("limit", 20) or 20), 100)
    offset = max(int(qs.get("offset", 0) or 0), 0)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM allocations {where_sql}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT {_PROJECTION} FROM allocations {where_sql} "
            f"ORDER BY start_date DESC LIMIT %s OFFSET %s",
            (*params, limit, offset),
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], allocation_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PROJECTION} FROM allocations WHERE id = %s", (allocation_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(row, event)


def _ensure_lead_can_write(user: dict, project_id: str) -> None:
    if user["role"] == "admin":
        return
    if user["role"] != "team_lead":
        raise AuthError(403, "Insufficient role")
    # Co-leads count as leads — see _lib/projects.is_project_lead.
    if not is_project_lead(db.get_conn(), project_id, user["id"]):
        raise AuthError(403, "Insufficient role")


def _project_owner_id(project_id: str) -> str | None:
    """Return the owner of a project, or ``None`` if it doesn't exist."""
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
    return row["owner_id"] if row else None


def _create(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    body = AllocationCreate(**http.parse_json_body(event))
    if body.end_date < body.start_date:
        raise ValueError("end_date: must be on or after start_date")

    # Determine permission + approval status by role.
    is_admin = user["role"] == "admin"
    target_user_id = body.user_id or user["id"]

    if is_admin:
        approval_status = "approved"
    elif user["role"] == "team_lead":
        # Two distinct sub-cases:
        #   * Owning lead allocating anyone (including themselves) →
        #     auto-approved, normal lead-of-project flow.
        #   * Non-owning lead asking to join the project → treated as a
        #     self-request (target=self, pending). They cannot allocate
        #     other people onto a project they do not own, mirroring the
        #     team_member rule. The owning lead must approve before any
        #     write access (deliverables, resources) opens up.
        is_self_only = body.user_id is None or body.user_id == user["id"]
        owns_project = is_project_lead(db.get_conn(), body.project_id, user["id"])
        if owns_project:
            approval_status = "approved"
        elif is_self_only:
            target_user_id = user["id"]
            approval_status = "pending"
        else:
            raise AuthError(
                403,
                "Non-owning team leads may only self-request allocations on "
                "this project",
            )
    elif user["role"] == "team_member":
        # Self-only. Team members may NOT allocate other people.
        if body.user_id and body.user_id != user["id"]:
            raise AuthError(403, "Team members may only self-request allocations")
        target_user_id = user["id"]
        approval_status = "pending"
    else:
        raise AuthError(403, "Insufficient role")

    approved_by = user["id"] if approval_status == "approved" else None
    approved_at = datetime.now(timezone.utc) if approval_status == "approved" else None

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO allocations (user_id, project_id, role_description,
                                     start_date, end_date,
                                     approval_status, requested_by, approved_by, approved_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {_PROJECTION}
            """,
            (target_user_id, body.project_id, body.role_description,
             body.start_date, body.end_date,
             approval_status, user["id"], approved_by, approved_at),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"],
                 "allocation.requested" if approval_status == "pending" else "allocation.created",
                 "allocation", row["id"],
                 {"user_id": target_user_id, "project_id": body.project_id,
                  "approval_status": approval_status})
    return http.created(dict(row), event)


def _patch(event: Mapping[str, Any], allocation_id: str) -> dict[str, Any]:
    user = current_user(event)
    body = AllocationPatch(**http.parse_json_body(event))
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ValueError("body: at least one field is required")
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PROJECTION} FROM allocations WHERE id = %s", (allocation_id,))
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    _ensure_lead_can_write(user, existing["project_id"])

    # Stamp approval metadata when transitioning to approved/rejected.
    if "approval_status" in fields and fields["approval_status"] in {"approved", "rejected"}:
        fields["approved_by"] = user["id"]
        fields["approved_at"] = datetime.now(timezone.utc)

    start = fields.get("start_date", existing["start_date"])
    end = fields.get("end_date", existing["end_date"])
    if end < start:
        raise ValueError("end_date: must be on or after start_date")
    set_sql = ", ".join(f"{k} = %s" for k in fields)
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE allocations SET {set_sql} WHERE id = %s RETURNING {_PROJECTION}",
            (*fields.values(), allocation_id),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "allocation.updated", "allocation", allocation_id, fields)
    return http.ok(row, event)


def _delete(event: Mapping[str, Any], allocation_id: str) -> dict[str, Any]:
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT project_id, user_id, approval_status FROM allocations WHERE id = %s",
                    (allocation_id,))
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    # Any non-admin user (team_member OR non-owning team_lead) may withdraw
    # their OWN pending self-request. Approved / rejected rows still require
    # the owning lead or an admin to delete — the audit trail matters.
    is_self_pending_withdraw = (
        user["role"] in {"team_member", "team_lead"}
        and existing["user_id"] == user["id"]
        and existing["approval_status"] == "pending"
    )
    if not is_self_pending_withdraw:
        _ensure_lead_can_write(user, existing["project_id"])
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM allocations WHERE id = %s", (allocation_id,))
        db.audit(conn, user["id"], "allocation.deleted", "allocation", allocation_id, None)
    return http.no_content(event)

