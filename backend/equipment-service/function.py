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
from decimal import Decimal
from typing import Any, Literal, Mapping

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.projects import is_project_lead
from _lib.validation import StrictModel, first_error

_LOG = logging.getLogger()
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
    # Optional direct link to the deliverable this asset supports.
    # When set, the equipment is still tracked at project level via
    # ``assigned_project_id``; this field narrows it to a specific output.
    assigned_deliverable_id: str | None = None
    notes: str = ""
    # Resource classification (migration 004). Tangible = physical asset
    # (laptop, vehicle, …); intangible = license, subscription, certification.
    is_tangible: bool = True
    # Optional cost — when set together with ``assigned_project_id`` the
    # write is gated by the project's remaining budget.
    cost: Decimal | None = Field(default=None, ge=Decimal("0"))
    currency: str = Field(default="USD", min_length=3, max_length=3)


class EquipmentPatch(StrictModel):
    """Body for ``PATCH /api/equipment-service/{id}``."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: str | None = Field(default=None, min_length=1, max_length=80)
    serial_number: str | None = Field(default=None, max_length=120)
    status: EquipmentStatus | None = None
    assigned_project_id: str | None = None
    assigned_user_id: str | None = None
    # Send ``null`` to unlink from a deliverable; omit the field entirely to
    # leave the current value unchanged (standard exclude_unset behaviour).
    assigned_deliverable_id: str | None = None
    notes: str | None = None
    approval_status: ApprovalStatus | None = None
    is_tangible: bool | None = None
    cost: Decimal | None = Field(default=None, ge=Decimal("0"))
    currency: str | None = Field(default=None, min_length=3, max_length=3)


_PROJECTION = (
    "id, name, kind, serial_number, status, assigned_project_id, "
    "assigned_user_id, assigned_deliverable_id, notes, created_at, updated_at, "
    "approval_status, requested_by, approved_by, approved_at, "
    "is_tangible, cost, currency"
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
    if did := qs.get("assigned_deliverable_id"):
        where.append("assigned_deliverable_id = %s"); params.append(did)
    # Tangible/intangible split — accepts the strings 'true' / 'false' (the
    # SPA sends them via URL-encoded booleans). Without this filter both
    # tabs would render the whole catalog, since the column would otherwise
    # only get strained on the client (or not at all).
    if (raw := qs.get("is_tangible")) is not None:
        if raw.lower() not in {"true", "false"}:
            raise ValueError("is_tangible: must be 'true' or 'false'")
        where.append("is_tangible = %s"); params.append(raw.lower() == "true")
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

def _project_owner(conn, project_id: str) -> str | None:
    """Return the owner of a project, or ``None`` if no such project exists."""
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
    return row["owner_id"] if row else None


def _user_approved_on_project(conn, user_id: str, project_id: str) -> bool:
    """True if the user holds an *approved* allocation on the project.

    Mirrors the same gate enforced by deliverables-service and
    assignments-service: contributors must be accepted onto a project via an
    approved allocation before they may add resources to it.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM allocations "
            " WHERE user_id = %s AND project_id = %s "
            "   AND approval_status = 'approved' LIMIT 1",
            (user_id, project_id),
        )
        return cur.fetchone() is not None


def _can_approve_for_project(conn, user: dict, project_id: str | None) -> bool:
    """True when ``user`` may flip an equipment row's approval_status.

    Equipment approval is intentionally **project-scoped** — see the user
    requirement that tangibles/intangibles can only be approved from
    within a project:

      * Items attached to a project are approved by the owning team_lead
        of that project, or by an admin.
      * Items with no project assignment can only be approved by admin
        (no project context means no lead has authority over them).
    """
    if user["role"] == "admin":
        return True
    if project_id is None:
        return False
    if user["role"] != "team_lead":
        return False
    return is_project_lead(conn, project_id, user["id"])


def _enforce_budget(
    conn,
    project_id: str | None,
    cost: Decimal | None,
    approval_status: str,
    exclude_equipment_id: str | None = None,
) -> None:
    """Reject the operation if it would push the project's committed
    equipment cost above ``projects.budget_amount``.

    Rules (intentionally explicit so the gate is debuggable from the audit
    log and from a single read of this docstring):

    * No project assignment → no gate (item lives in the catalog, not yet
      attached to anything that has a budget).
    * No cost on the row being written → no gate.
    * ``approval_status == 'rejected'`` → no gate. Rejected rows are not
      treated as reservations.
    * Project has no ``budget_amount`` (NULL) → no gate. The owner hasn't
      declared a ceiling, so we have nothing to enforce.
    * Otherwise: sum the ``cost`` of every other approved+pending row
      assigned to the same project (excluding ``exclude_equipment_id`` so
      we don't double-count the row being patched) and require
      ``committed + cost <= budget_amount``.
    """
    if project_id is None or cost is None or approval_status == "rejected":
        return
    with conn.cursor() as cur:
        cur.execute(
            "SELECT budget_amount, budget_currency FROM projects WHERE id = %s",
            (project_id,),
        )
        project = cur.fetchone()
    if project is None or project["budget_amount"] is None:
        # FK violation on the assignment will surface its own error; if the
        # project simply has no ceiling, there's nothing to enforce.
        return
    budget = project["budget_amount"]
    extra = ""
    params: list[Any] = [project_id]
    if exclude_equipment_id is not None:
        extra = "AND id <> %s"
        params.append(exclude_equipment_id)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT COALESCE(SUM(cost), 0)::numeric(14,2) AS committed
            FROM equipment
            WHERE assigned_project_id = %s
              AND cost IS NOT NULL
              AND approval_status IN ('approved', 'pending')
              {extra}
            """,
            params,
        )
        committed = Decimal(cur.fetchone()["committed"])
    if committed + Decimal(cost) > Decimal(budget):
        raise ValueError(
            f"cost: assigning this item would exceed the project's remaining "
            f"budget (committed {committed} + this {cost} > budget {budget} "
            f"{project['budget_currency']})"
        )


def _create(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    body = EquipmentCreate(**http.parse_json_body(event))
    conn = db.get_conn()

    # ── authorisation ─────────────────────────────────────────────────
    # Equipment splits into two write paths:
    #   1. catalog-only (assigned_project_id is None):
    #        admin / team_lead → approved; team_member → pending. No
    #        per-project allocation gate because there is no project yet.
    #   2. project-attached (assigned_project_id is set):
    #        admin / owning lead   → approved.
    #        other lead / member   → require an *approved* allocation on
    #                                 that project; the row lands pending
    #                                 and the owning lead must accept it.
    #        anyone else           → 403.
    #
    # Approval (via PATCH) is project-scoped (see _can_approve_for_project),
    # which is why every project-attached create that isn't from admin or
    # the owning lead must start life as pending — the only people who can
    # flip it are the project's own owner and admins.
    if user["role"] not in {"admin", "team_lead", "team_member"}:
        # Viewers and unknown roles are read-only.
        raise AuthError(403, "Insufficient role")

    if body.assigned_project_id is None:
        approval_status = "approved" if user["role"] in {"admin", "team_lead"} else "pending"
    else:
        owner = _project_owner(conn, body.assigned_project_id)
        if owner is None:
            return http.not_found("Project not found", event)
        is_owning_lead = (
            user["role"] == "team_lead"
            and is_project_lead(conn, body.assigned_project_id, user["id"])
        )
        if user["role"] == "admin" or is_owning_lead:
            approval_status = "approved"
        elif _user_approved_on_project(conn, user["id"], body.assigned_project_id):
            # Allocated contributor (lead or member): may propose for the
            # project, but the owning lead must accept it before it counts
            # toward the budget.
            approval_status = "pending"
        else:
            raise AuthError(
                403,
                "You must hold an approved allocation on this project to add "
                "resources to it",
            )

    approved_by = user["id"] if approval_status == "approved" else None
    approved_at = datetime.now(timezone.utc) if approval_status == "approved" else None

    # Budget gate before INSERT so a busting row never lands in the table,
    # not even inside a rolled-back transaction (the audit log would still
    # show it otherwise).
    _enforce_budget(
        conn, body.assigned_project_id, body.cost, approval_status,
    )

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO equipment (
                name, kind, serial_number, status,
                assigned_project_id, assigned_user_id, assigned_deliverable_id,
                notes, approval_status, requested_by, approved_by, approved_at,
                is_tangible, cost, currency
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {_PROJECTION}
            """,
            (
                body.name, body.kind.strip(), body.serial_number, body.status,
                body.assigned_project_id, body.assigned_user_id,
                body.assigned_deliverable_id, body.notes,
                approval_status, user["id"], approved_by, approved_at,
                body.is_tangible, body.cost, body.currency.upper(),
            ),
        )
        row = cur.fetchone()
        db.audit(
            conn, user["id"],
            "equipment.requested" if approval_status == "pending" else "equipment.created",
            "equipment", row["id"],
            {
                "name": body.name, "kind": body.kind,
                "is_tangible": body.is_tangible,
                "approval_status": approval_status,
                "assigned_project_id": body.assigned_project_id,
                "cost": str(body.cost) if body.cost is not None else None,
            },
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
    #   - admin                       → may PATCH anything (approve, reassign, edit).
    #   - team_lead owning the item's project → may PATCH anything *on that
    #     item* (approve, reassign, edit). Approval is intentionally
    #     project-scoped so leads cannot rubber-stamp items belonging to a
    #     project they have no responsibility for.
    #   - any other team_lead         → may edit non-approval fields only
    #     when they are themselves the requester (lets a lead correct a
    #     typo on their own pending proposal).
    #   - team_member                 → may edit their own *pending* row
    #     (no approval_status flip).
    is_admin = user["role"] == "admin"
    is_owning_lead = (
        user["role"] == "team_lead"
        and existing["assigned_project_id"] is not None
        and is_project_lead(conn, existing["assigned_project_id"], user["id"])
    )
    is_self_pending_edit = (
        existing["requested_by"] == user["id"]
        and existing["approval_status"] == "pending"
    )

    flipping_approval = "approval_status" in fields
    if flipping_approval:
        # Approval can only happen via the owning project's lead or admin —
        # the global ResourcesPage cannot approve items because there is no
        # project context for the gate. See _can_approve_for_project.
        resulting_project = fields.get(
            "assigned_project_id", existing["assigned_project_id"],
        )
        if not _can_approve_for_project(conn, user, resulting_project):
            raise AuthError(
                403,
                "Only the project's owning team lead (or an admin) may "
                "approve resources for that project",
            )
    elif not (is_admin or is_owning_lead):
        # Non-approval edit: must be the requester editing their own
        # pending row.
        if not is_self_pending_edit:
            raise AuthError(403, "Insufficient role")

    # Stamp approval metadata when transitioning to a terminal state.
    if "approval_status" in fields and fields["approval_status"] in {"approved", "rejected"}:
        fields["approved_by"] = user["id"]
        fields["approved_at"] = datetime.now(timezone.utc)

    # Normalise the free-form kind on update.
    if "kind" in fields and fields["kind"] is not None:
        fields["kind"] = fields["kind"].strip()
    # Normalise currency on update.
    if "currency" in fields and fields["currency"] is not None:
        fields["currency"] = fields["currency"].upper()

    # Budget re-check when the assignment, cost or approval state is being
    # changed. We use the *resulting* project + cost + approval (post-patch)
    # and exclude the row's own current reservation so a no-op assign doesn't
    # double-count itself. A rejected→approved flip alone must trigger the
    # gate because previously the row was excluded from the committed total.
    resulting_project = fields.get("assigned_project_id", existing["assigned_project_id"])
    resulting_cost = fields.get("cost", existing["cost"])
    resulting_approval = fields.get("approval_status", existing["approval_status"])
    if (
        "assigned_project_id" in fields
        or "cost" in fields
        or "approval_status" in fields
    ):
        _enforce_budget(
            db.get_conn(),
            resulting_project,
            Decimal(resulting_cost) if resulting_cost is not None else None,
            resulting_approval,
            exclude_equipment_id=equipment_id,
        )

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

