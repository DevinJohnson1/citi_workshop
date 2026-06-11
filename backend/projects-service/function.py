"""projects-service — CRUD for the ``projects`` table.

Function URL payload v2.0. Dispatches purely on
``event['requestContext']['http']['method']`` + ``event['rawPath']``;
no web framework on Lambda (SYSTEM_DESIGN §0).
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Mapping, get_args

import psycopg
from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.projects import is_project_lead, project_lead_ids
from _lib.validation import ProjectStatus, StrictModel, first_error

_LOG = logging.getLogger()
_SERVICE = "projects-service"
_SORTABLE = {"name", "status", "start_date", "target_end_date", "created_at"}
# Derived from the pydantic type so we never drift from the schema's CHECK
# constraint when validating ``?status=`` on the list endpoint.
_ALLOWED_STATUS: frozenset[str] = frozenset(get_args(ProjectStatus))

# A project is "at risk" when (a) it's still in flight — status is one of
# 'planned', 'active', 'on_hold' — and (b) at least one of its deliverables
# is outdated (its due date has passed and the deliverable itself is not
# done/cancelled). Projects already 'done' or 'cancelled' are never
# at-risk, regardless of dangling deliverables.
_PROJECT_IN_FLIGHT_STATUSES = "('planned','active','on_hold')"
_AT_RISK_SQL = (
    f"(projects.status IN {_PROJECT_IN_FLIGHT_STATUSES} "
    " AND EXISTS ( "
    "     SELECT 1 FROM deliverables d "
    "      WHERE d.project_id = projects.id "
    "        AND d.due_date IS NOT NULL "
    "        AND d.due_date < CURRENT_DATE "
    "        AND d.status NOT IN ('done','cancelled') "
    " ))"
)
# Standard projection: every column plus the computed is_at_risk flag.
_PROJECTION = f"projects.*, {_AT_RISK_SQL} AS is_at_risk"


class ProjectCreate(StrictModel):
    """Body for ``POST /api/projects-service``.

    ``owner_id`` is optional. When omitted/null, ``_create`` falls back to
    the caller's own id. Integrity of the id is enforced by the
    ``projects.owner_id`` FK to ``users.id`` (FK violation → 400). The
    role-based restriction on *who appears* in the Owner picker is a
    client-side filter only — see ``ProjectCreatePage.tsx``.
    """

    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    status: ProjectStatus = "planned"
    start_date: date | None = None
    target_end_date: date | None = None
    owner_id: str | None = None
    # Singular budget ceiling — NULL means "no budget set, equipment-service
    # skips the budget gate". The budget-service is the canonical writer for
    # ongoing updates, but accepting it at creation time saves a round trip.
    budget_amount: Decimal | None = Field(default=None, ge=Decimal("0"))
    budget_currency: str = Field(default="USD", min_length=3, max_length=3)


class ProjectPatch(StrictModel):
    """Body for ``PATCH /api/projects-service/{id}``. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: ProjectStatus | None = None
    start_date: date | None = None
    target_end_date: date | None = None
    actual_end_date: date | None = None
    # Ownership is patchable so leads can claim a project (assign themselves
    # as owner) without needing an admin round-trip. Authorisation rules in
    # ``_patch`` keep this honest: an admin may reassign to anyone, while a
    # team_lead may only ever set ``owner_id`` to their own id.
    owner_id: str | None = None
    # Budget fields are accepted here too so the create form and any inline
    # project edit can change them; the budget-service still owns the
    # validation that the new ceiling isn't below already-committed costs.
    budget_amount: Decimal | None = Field(default=None, ge=Decimal("0"))
    budget_currency: str | None = Field(default=None, min_length=3, max_length=3)


def handler(event: Mapping[str, Any], context: Any = None) -> dict[str, Any]:
    """Lambda entrypoint. See module docstring for dispatch rules."""
    if http.is_options(event):
        return http.no_content(event)

    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "GET").upper()
    parts = http.path_parts(event, _SERVICE)

    try:
        # Public health check (no auth).
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
        # Co-lead management: /api/projects-service/{id}/leads[/{user_id}]
        if method == "GET" and len(parts) == 2 and parts[1] == "leads":
            verify_token(event)
            return _list_leads(event, parts[0])
        if method == "POST" and len(parts) == 2 and parts[1] == "leads":
            return _add_lead(event, parts[0])
        if method == "DELETE" and len(parts) == 3 and parts[1] == "leads":
            return _remove_lead(event, parts[0], parts[2])
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


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _attach_leads(conn: Any, row: dict[str, Any]) -> dict[str, Any]:
    """Annotate a project row with its ``lead_ids`` (owner first, co-leads).

    Cheap enough to call per row in list responses — list pages cap at 100
    and the lookup is two index hits.
    """
    row["lead_ids"] = project_lead_ids(conn, row["id"])
    return row

def _list(event: Mapping[str, Any]) -> dict[str, Any]:
    """``GET /api/projects-service`` with optional filters + pagination."""
    qs = http.query_params(event)
    where: list[str] = []
    params: list[Any] = []

    if status := qs.get("status"):
        if status not in _ALLOWED_STATUS:
            raise ValueError(f"status: must be one of {sorted(_ALLOWED_STATUS)}")
        where.append("status = %s")
        params.append(status)
    if owner := qs.get("owner_id"):
        where.append("owner_id = %s")
        params.append(owner)
    if q := qs.get("q"):
        where.append("LOWER(name) LIKE %s")
        params.append(f"%{q.lower()}%")
    if qs.get("at_risk") == "true":
        # "At risk" = the project has at least one outdated deliverable and
        # the project itself isn't done/cancelled. See _AT_RISK_SQL above.
        where.append(_AT_RISK_SQL)

    limit = min(int(qs.get("limit", 20) or 20), 100)
    offset = max(int(qs.get("offset", 0) or 0), 0)
    sort = qs.get("sort", "created_at")
    if sort not in _SORTABLE:
        sort = "created_at"
    order = "ASC" if qs.get("order", "desc").lower() == "asc" else "DESC"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM projects {where_sql}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT {_PROJECTION} FROM projects {where_sql} "
            f"ORDER BY {sort} {order} LIMIT %s OFFSET %s",
            (*params, limit, offset),
        )
        rows = cur.fetchall()
    rows = [_attach_leads(conn, r) for r in rows]
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PROJECTION} FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(_attach_leads(conn, row), event)


# ---------------------------------------------------------------------------
# Auto-allocation for project leads
# ---------------------------------------------------------------------------
#
# When a user gains lead status on a project (becomes owner at create time,
# is appointed co-lead, or has ownership transferred to them), we create an
# approved allocation for them spanning the project term. When they lose
# lead status (ownership transferred away, removed as co-lead) we close
# that allocation by setting its `end_date` to today — preserving the
# historical record of when they joined and when they stepped away.
#
# Allocations are tagged via `role_description` so we can find the right
# row to close on removal:
#   * "Project lead"    — for the canonical owner
#   * "Project co-lead" — for entries in project_leads
#
# A "fall-back end date" of one year out is used when the project has no
# target_end_date; the schema requires both dates to be non-null and the
# end ≥ start.

_LEAD_OWNER_ROLE = "Project lead"
_LEAD_CO_ROLE = "Project co-lead"
_LEAD_ROLE_DESCRIPTIONS = (_LEAD_OWNER_ROLE, _LEAD_CO_ROLE)
# Default span when the project has no target_end_date — keeps the
# auto-allocation finite (the reports/over-allocation views want a finite
# window) while being generous enough for a typical engagement.
_LEAD_DEFAULT_SPAN_DAYS = 365


def _project_lead_window(project_row: Mapping[str, Any]) -> tuple[date, date]:
    """Return (start_date, end_date) for an auto lead allocation.

    Mirrors the project's own dates when present and falls back to a
    today-based window otherwise. The schema's CHECK forces end ≥ start so
    we clamp the end to at least the start.
    """
    today = date.today()
    start: date = project_row["start_date"] or today
    end: date = project_row["target_end_date"] or (start + timedelta(days=_LEAD_DEFAULT_SPAN_DAYS))
    if end < start:
        end = start
    return start, end


def _open_lead_allocation(
    conn: Any,
    *,
    project_id: str,
    user_id: str,
    actor_id: str,
    role_description: str,
    start: date,
    end: date,
) -> None:
    """Insert an approved lead allocation if one isn't already open.

    Idempotent: if the user already holds a still-open auto lead
    allocation on this project (one whose end_date is today or later AND
    whose role_description matches one of our tags), we leave it alone.
    Manual allocations created by a lead for themselves earlier are
    deliberately ignored — they live in their own row and are managed
    through allocations-service.
    """
    today = date.today()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM allocations
             WHERE project_id = %s
               AND user_id    = %s
               AND role_description = ANY(%s)
               AND approval_status  = 'approved'
               AND end_date   >= %s
             LIMIT 1
            """,
            (project_id, user_id, list(_LEAD_ROLE_DESCRIPTIONS), today),
        )
        if cur.fetchone() is not None:
            return
        cur.execute(
            """
            INSERT INTO allocations
                (user_id, project_id, role_description,
                 start_date, end_date,
                 approval_status, requested_by, approved_by, approved_at)
            VALUES (%s, %s, %s, %s, %s, 'approved', %s, %s, NOW())
            """,
            (user_id, project_id, role_description, start, end, actor_id, actor_id),
        )
        db.audit(conn, actor_id, "allocation.auto_lead_opened", "project", project_id,
                 {"user_id": user_id, "role_description": role_description,
                  "start_date": start.isoformat(), "end_date": end.isoformat()})


def _close_lead_allocation(
    conn: Any,
    *,
    project_id: str,
    user_id: str,
    actor_id: str,
) -> None:
    """Close any still-open auto lead allocation by setting end_date=today.

    Targets only the rows we created via `_open_lead_allocation` (tagged
    role_description). Multiple still-open rows are all closed — should
    not happen in practice but the loop is harmless and keeps the
    invariant clean.
    """
    today = date.today()
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE allocations
               SET end_date = %s
             WHERE project_id = %s
               AND user_id    = %s
               AND role_description = ANY(%s)
               AND end_date   >= %s
             RETURNING id
            """,
            (today, project_id, user_id, list(_LEAD_ROLE_DESCRIPTIONS), today),
        )
        closed = [r["id"] for r in cur.fetchall()]
    if closed:
        db.audit(conn, actor_id, "allocation.auto_lead_closed", "project", project_id,
                 {"user_id": user_id, "closed_allocation_ids": closed,
                  "end_date": today.isoformat()})


# ---------------------------------------------------------------------------
# Handlers (continued)
# ---------------------------------------------------------------------------


def _create(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    if user["role"] not in {"admin", "team_lead"}:
        raise AuthError(403, "Insufficient role")
    body = ProjectCreate(**http.parse_json_body(event))
    # Caller-supplied owner_id wins; otherwise the creator owns the project.
    owner_id = body.owner_id or user["id"]

    try:
        with db.transaction() as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                WITH ins AS (
                    INSERT INTO projects (name, description, status, start_date,
                                          target_end_date, owner_id,
                                          budget_amount, budget_currency)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING *
                )
                SELECT ins.*, FALSE AS is_at_risk FROM ins
                """,  # noqa: S608 — no user input in the SQL fragment
                (body.name, body.description, body.status, body.start_date,
                 body.target_end_date, owner_id,
                 body.budget_amount, body.budget_currency.upper()),
            )
            row = cur.fetchone()
            db.audit(conn, user["id"], "project.created", "project", row["id"],
                     {"name": row["name"], "owner_id": owner_id})
            # Auto-allocate the canonical owner for the project term so the
            # ownership relationship is reflected in workload + reports
            # from the moment of creation.
            start, end = _project_lead_window(row)
            _open_lead_allocation(
                conn,
                project_id=row["id"],
                user_id=owner_id,
                actor_id=user["id"],
                role_description=_LEAD_OWNER_ROLE,
                start=start,
                end=end,
            )
    except psycopg.errors.ForeignKeyViolation as exc:
        # Most likely: owner_id does not match any users.id.
        raise ValueError("owner_id: unknown user") from exc
    return http.created(_attach_leads(db.get_conn(), row), event)


def _patch(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)

    body = ProjectPatch(**http.parse_json_body(event))
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise ValueError("body: at least one field is required")

    # Authorisation. Admins may patch any project, including reassigning
    # ``owner_id`` freely. A team_lead may patch a project when they are
    # either (a) the current owner or (b) becoming the owner in this same
    # request (an ownership claim). In neither lead case may they hand
    # ownership off to a third party — leads can only ever set owner_id to
    # themselves.
    is_admin = user["role"] == "admin"
    # Any project lead (owner OR co-lead) may patch the project — so co-leads
    # can drive status changes, update dates, edit budget, etc.
    is_owning_lead = (
        user["role"] == "team_lead"
        and is_project_lead(conn, project_id, user["id"])
    )
    is_claiming_lead = (
        user["role"] == "team_lead"
        and "owner_id" in fields
        and fields["owner_id"] == user["id"]
    )
    if not (is_admin or is_owning_lead or is_claiming_lead):
        raise AuthError(403, "Insufficient role")
    if (
        not is_admin
        and "owner_id" in fields
        and fields["owner_id"] != user["id"]
    ):
        raise AuthError(
            403, "team_leads may only assign project ownership to themselves"
        )

    # Normalise currency to upper so the CHECK on equipment.currency and any
    # client comparison work without case games.
    if "budget_currency" in fields and fields["budget_currency"] is not None:
        fields["budget_currency"] = fields["budget_currency"].upper()

    # If lowering the budget ceiling, refuse to push it under what's already
    # been committed to equipment assigned to this project. Mirrors the
    # check in budget-service so both write paths behave identically.
    if "budget_amount" in fields and fields["budget_amount"] is not None:
        with db.get_conn().cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(cost), 0)::numeric(14,2) AS committed
                FROM equipment
                WHERE assigned_project_id = %s
                  AND cost IS NOT NULL
                  AND approval_status IN ('approved', 'pending')
                """,
                (project_id,),
            )
            committed = cur.fetchone()["committed"]
        if Decimal(fields["budget_amount"]) < Decimal(committed):
            raise ValueError(
                f"budget_amount: cannot be lower than already committed "
                f"equipment costs ({committed})"
            )

    set_sql = ", ".join(f"{k} = %s" for k in fields)
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            WITH upd AS (
                UPDATE projects SET {set_sql} WHERE id = %s RETURNING *
            )
            SELECT upd.*,
                   (upd.status IN ('planned','active','on_hold')
                    AND EXISTS (
                        SELECT 1 FROM deliverables d
                         WHERE d.project_id = upd.id
                           AND d.due_date IS NOT NULL
                           AND d.due_date < CURRENT_DATE
                           AND d.status NOT IN ('done','cancelled')
                    )) AS is_at_risk
            FROM upd
            """,
            (*fields.values(), project_id),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "project.updated", "project", project_id, fields)
        # Owner transfer: close the previous owner's auto lead allocation
        # (mark them as having "left" today) and open one for the new
        # owner spanning the (possibly updated) project term. Co-leads are
        # untouched — ownership change is independent of co-lead status.
        if "owner_id" in fields and fields["owner_id"] != existing["owner_id"]:
            _close_lead_allocation(
                conn,
                project_id=project_id,
                user_id=existing["owner_id"],
                actor_id=user["id"],
            )
            start, end = _project_lead_window(row)
            _open_lead_allocation(
                conn,
                project_id=project_id,
                user_id=fields["owner_id"],
                actor_id=user["id"],
                role_description=_LEAD_OWNER_ROLE,
                start=start,
                end=end,
            )
    return http.ok(_attach_leads(db.get_conn(), row), event)


# --- lead management ---------------------------------------------------------


class LeadCreate(StrictModel):
    """Body for ``POST /api/projects-service/{id}/leads``."""

    user_id: str


def _list_leads(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    """Return the owner + co-lead ids for a project.

    Open to any authenticated user — leads are publicly visible attribution
    metadata, mirroring how ``project.owner_id`` already is.
    """
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM projects WHERE id = %s", (project_id,))
        if cur.fetchone() is None:
            return http.not_found(event=event)
    ids = project_lead_ids(conn, project_id)
    return http.ok({"data": ids, "meta": {"total": len(ids)}}, event)


def _add_lead(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    """Add a co-lead to the project.

    Authorisation mirrors ``_patch``: admin or any current project lead
    (owner / existing co-lead). The added user must already have the
    ``team_lead`` role — members and viewers cannot be promoted to lead
    via this endpoint; that's a user-management concern handled by the
    admin in resources-service. We refuse to add the canonical owner as a
    co-lead too (it would be redundant — owners are leads by definition).
    """
    user = current_user(event)
    body = LeadCreate(**http.parse_json_body(event))
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        project_row = cur.fetchone()
    if project_row is None:
        return http.not_found(event=event)

    is_admin = user["role"] == "admin"
    is_lead = (
        user["role"] == "team_lead"
        and is_project_lead(conn, project_id, user["id"])
    )
    if not (is_admin or is_lead):
        raise AuthError(403, "Insufficient role")

    with conn.cursor() as cur:
        cur.execute("SELECT role FROM users WHERE id = %s", (body.user_id,))
        target = cur.fetchone()
    if target is None:
        raise ValueError("user_id: unknown user")
    if target["role"] != "team_lead":
        raise ValueError("user_id: only team_lead users may be added as co-leads")
    if body.user_id == project_row["owner_id"]:
        raise ValueError("user_id: that user is already the project owner")

    with db.transaction() as conn, conn.cursor() as cur:
        # Idempotent — re-adding an existing co-lead is a no-op rather than
        # a 409, which simplifies SPA flows where the operator clicks twice.
        cur.execute(
            """
            INSERT INTO project_leads (project_id, user_id, added_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (project_id, user_id) DO NOTHING
            """,
            (project_id, body.user_id, user["id"]),
        )
        db.audit(conn, user["id"], "project_lead.added", "project", project_id,
                 {"user_id": body.user_id})
        # Auto-allocate the new co-lead for the rest of the project term
        # (or one year, if the project has no target end). Start date is
        # either the project's start or today — whichever is later — so
        # the allocation reflects "joined as co-lead today" rather than
        # back-dating to the project's start.
        cur.execute(
            "SELECT start_date, target_end_date FROM projects WHERE id = %s",
            (project_id,),
        )
        project_dates = cur.fetchone()
        if project_dates is not None:
            start, end = _project_lead_window(project_dates)
            today = date.today()
            if start < today:
                start = today
            if end < start:
                end = start
            _open_lead_allocation(
                conn,
                project_id=project_id,
                user_id=body.user_id,
                actor_id=user["id"],
                role_description=_LEAD_CO_ROLE,
                start=start,
                end=end,
            )
    ids = project_lead_ids(db.get_conn(), project_id)
    return http.ok({"data": ids, "meta": {"total": len(ids)}}, event)


def _remove_lead(event: Mapping[str, Any], project_id: str, user_id: str) -> dict[str, Any]:
    """Remove a co-lead from the project.

    Same authorisation as ``_add_lead``. Removing the canonical owner is
    refused — to change ownership the owner must be transferred via the
    ``PATCH`` ``owner_id`` flow (which has stricter rules). Leads may
    voluntarily remove themselves (step down) — this is just a degenerate
    case of "any current lead may remove a co-lead".
    """
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        project_row = cur.fetchone()
    if project_row is None:
        return http.not_found(event=event)
    if user_id == project_row["owner_id"]:
        raise ValueError(
            "user_id: cannot remove the canonical owner — transfer ownership instead"
        )

    is_admin = user["role"] == "admin"
    is_lead = (
        user["role"] == "team_lead"
        and is_project_lead(conn, project_id, user["id"])
    )
    if not (is_admin or is_lead):
        raise AuthError(403, "Insufficient role")

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM project_leads WHERE project_id = %s AND user_id = %s",
            (project_id, user_id),
        )
        db.audit(conn, user["id"], "project_lead.removed", "project", project_id,
                 {"user_id": user_id})
        # Close their auto co-lead allocation as of today so workload &
        # reports stop counting them — the row is kept (end_date=today)
        # rather than deleted so the history of "joined on X, left on Y"
        # is preserved.
        _close_lead_allocation(
            conn,
            project_id=project_id,
            user_id=user_id,
            actor_id=user["id"],
        )
    return http.no_content(event)


def _delete(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    """Delete a project (admin, or the team_lead who owns it).

    Cascading removal of dependent rows is handled at the schema level:
    ``deliverables`` and ``allocations`` declare
    ``REFERENCES projects(id) ON DELETE CASCADE`` (see migration 001), so
    a single ``DELETE FROM projects`` wipes everything attached to the
    project in the same transaction. ``equipment.assigned_project_id`` is
    ``ON DELETE SET NULL`` — equipment is org-wide and survives the
    project; it just loses its assignment (and therefore its draw against
    that project's budget). The project's singular ``budget_amount`` lives
    on the row itself and disappears with it.

    Authorisation: ``admin`` may delete any project; a ``team_lead`` may
    delete only projects they own. team_members and viewers cannot delete.
    The UI confirmation ("type DELETE to proceed") is a usability guard,
    not a security boundary — this role check is the real one.
    """
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    is_admin = user["role"] == "admin"
    is_owning_lead = (
        user["role"] == "team_lead" and existing["owner_id"] == user["id"]
    )
    if not (is_admin or is_owning_lead):
        raise AuthError(403, "Insufficient role")

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM projects WHERE id = %s RETURNING id", (project_id,))
        if not cur.fetchone():
            # Lost a race with another deleter — surface as 404 not 500.
            return http.not_found(event=event)
        db.audit(conn, user["id"], "project.deleted", "project", project_id, None)
    return http.no_content(event)

