"""equipment-service — CRUD on tangible-asset resources (``equipment``).

Schema notes
------------
* ``kind`` is a free-form TEXT column (migration 003 dropped the CHECK
  constraint). Any tangible-asset taxonomy is accepted — laptop, vehicle,
  software license, conference room, 3d-printer, forklift, vr-headset, …
  The UI offers historical values as datalist hints via the
  ``GET /kinds`` endpoint but does not constrain the input.
* ``status`` retains a CHECK constraint
  (``available|in_use|maintenance|retired``) because it gates business
  logic and must not drift.
* Approval workflow (migration 003): rows carry
  ``approval_status`` ∈ {``pending``,``approved``,``rejected``}. Writes by
  admin or team_lead default to ``approved``; writes by a team_member are
  forced to ``pending`` until an admin or team_lead PATCHes the status.
  Equipment is org-wide (not project-owned) so *any* team_lead can approve.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal, Mapping

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.validation import StrictModel, first_error

_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)
_SERVICE = "equipment-service"

EquipmentStatus = Literal["available", "in_use", "maintenance", "retired"]
ApprovalStatus = Literal["pending", "approved", "rejected"]


class EquipmentCreate(StrictModel):
    """Body for ``POST /api/equipment-service``."""

    name: str = Field(min_length=1, max_length=200)
    # Free-form taxonomy: bounded only to keep payloads sane.
    kind: str = Field(min_length=1, max_length=80)
    serial_number: str | None = Field(default=None, max_length=120)
    status: EquipmentStatus = "available"
    assigned_project_id: str | None = None
    assigned_user_id: str | None = None
    notes: str = ""


class EquipmentPatch(StrictModel):
    """Body for ``PATCH /api/equipment-service/{id}``."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: str | None = Field(default=None, min_length=1, max_length=80)
    serial_number: str | None = Field(default=None, max_length=120)
    status: EquipmentStatus | None = None
    assigned_project_id: str | None = None
    assigned_user_id: str | None = None
    notes: str | None = None
    approval_status: ApprovalStatus | None = None


_PROJECTION = (
    "id, name, kind, serial_number, status, assigned_project_id, "
    "assigned_user_id, notes, created_at, updated_at, "
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
        if method == "GET" and parts == ["kinds"]:
            verify_token(event)
            return _list_kinds(event)
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


# ── reads ──────────────────────────────────────────────────────────────────

def _list(event: Mapping[str, Any]) -> dict[str, Any]:
    qs = http.query_params(event)
    where: list[str] = []
    params: list[Any] = []
    # Case-insensitive exact match for kind so the free-form input plays
    # nicely with mixed-case historical values.
    if kind := qs.get("kind"):
        where.append("LOWER(kind) = LOWER(%s)"); params.append(kind)
    if status := qs.get("status"):
        where.append("status = %s"); params.append(status)
    if approval := qs.get("approval_status"):
        where.append("approval_status = %s"); params.append(approval)
    if pid := qs.get("assigned_project_id"):
        where.append("assigned_project_id = %s"); params.append(pid)
    if uid := qs.get("assigned_user_id"):
        where.append("assigned_user_id = %s"); params.append(uid)
    limit = min(int(qs.get("limit", 20) or 20), 100)
    offset = max(int(qs.get("offset", 0) or 0), 0)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM equipment {where_sql}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT {_PROJECTION} FROM equipment {where_sql} "
            f"ORDER BY created_at DESC LIMIT %s OFFSET %s",
            (*params, limit, offset),
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], equipment_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PROJECTION} FROM equipment WHERE id = %s", (equipment_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(row, event)


def _list_kinds(event: Mapping[str, Any]) -> dict[str, Any]:
    """Return the distinct ``kind`` values currently in use.

    Powers the UI autocomplete/datalist so users discover the taxonomy
    the organisation has organically settled on, without us hard-coding it.
    """
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT kind FROM equipment "
            "WHERE kind IS NOT NULL AND kind <> '' "
            "ORDER BY kind"
        )
        rows = cur.fetchall()
    return http.ok({"data": [r["kind"] for r in rows]}, event)


# ── writes ─────────────────────────────────────────────────────────────────

def _can_approve(role: str) -> bool:
    """Equipment is org-wide — any admin or team_lead may approve."""
    return role in {"admin", "team_lead"}


def _create(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    body = EquipmentCreate(**http.parse_json_body(event))

    if user["role"] in {"admin", "team_lead"}:
        approval_status = "approved"
    elif user["role"] == "team_member":
        # Team members can propose any tangible asset; a lead must approve.
        approval_status = "pending"
    else:
        # Viewers and unknown roles are read-only.
        raise AuthError(403, "Insufficient role")

    approved_by = user["id"] if approval_status == "approved" else None
    approved_at = datetime.now(timezone.utc) if approval_status == "approved" else None

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO equipment (
                name, kind, serial_number, status,
                assigned_project_id, assigned_user_id, notes,
                approval_status, requested_by, approved_by, approved_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {_PROJECTION}
            """,
            (
                body.name, body.kind.strip(), body.serial_number, body.status,
                body.assigned_project_id, body.assigned_user_id, body.notes,
                approval_status, user["id"], approved_by, approved_at,
            ),
        )
        row = cur.fetchone()
        db.audit(
            conn, user["id"],
            "equipment.requested" if approval_status == "pending" else "equipment.created",
            "equipment", row["id"],
            {"name": body.name, "kind": body.kind, "approval_status": approval_status},
        )
    return http.created(row, event)


def _patch(event: Mapping[str, Any], equipment_id: str) -> dict[str, Any]:
    user = current_user(event)
    body = EquipmentPatch(**http.parse_json_body(event))
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ValueError("body: at least one field is required")

    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PROJECTION} FROM equipment WHERE id = %s", (equipment_id,))
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)

    # Authorisation rules:
    #   - admin / team_lead may PATCH anything (approve, reassign, edit).
    #   - team_member may edit their own *pending* row (e.g. fix a typo)
    #     but may not flip approval_status — only leads can do that.
    is_owner_pending_edit = (
        user["role"] == "team_member"
        and existing["requested_by"] == user["id"]
        and existing["approval_status"] == "pending"
    )
    if not _can_approve(user["role"]):
        if not is_owner_pending_edit:
            raise AuthError(403, "Insufficient role")
        if "approval_status" in fields:
            raise AuthError(403, "Only leads may change approval_status")

    # Stamp approval metadata when transitioning to a terminal state.
    if "approval_status" in fields and fields["approval_status"] in {"approved", "rejected"}:
        fields["approved_by"] = user["id"]
        fields["approved_at"] = datetime.now(timezone.utc)

    # Normalise the free-form kind on update.
    if "kind" in fields and fields["kind"] is not None:
        fields["kind"] = fields["kind"].strip()

    set_sql = ", ".join(f"{k} = %s" for k in fields)
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE equipment SET {set_sql} WHERE id = %s RETURNING {_PROJECTION}",
            (*fields.values(), equipment_id),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "equipment.updated", "equipment", equipment_id, fields)
    return http.ok(row, event)


def _delete(event: Mapping[str, Any], equipment_id: str) -> dict[str, Any]:
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT requested_by, approval_status FROM equipment WHERE id = %s",
            (equipment_id,),
        )
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)

    # Withdraw: a team_member may delete their own pending request.
    # Otherwise admin-only — equipment is org-wide and we don't want a
    # single team_lead retiring assets unilaterally.
    is_self_pending_withdraw = (
        user["role"] == "team_member"
        and existing["requested_by"] == user["id"]
        and existing["approval_status"] == "pending"
    )
    if not is_self_pending_withdraw and user["role"] != "admin":
        raise AuthError(403, "Insufficient role")

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM equipment WHERE id = %s", (equipment_id,))
        db.audit(conn, user["id"], "equipment.deleted", "equipment", equipment_id, None)
    return http.no_content(event)

