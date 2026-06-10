"""projects-service — CRUD for the ``projects`` table.

Function URL payload v2.0. Dispatches purely on
``event['requestContext']['http']['method']`` + ``event['rawPath']``;
no web framework on Lambda (SYSTEM_DESIGN §0).
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Any, Mapping, get_args

import psycopg
from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
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
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PROJECTION} FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(row, event)


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
    except psycopg.errors.ForeignKeyViolation as exc:
        # Most likely: owner_id does not match any users.id.
        raise ValueError("owner_id: unknown user") from exc
    return http.created(row, event)


def _patch(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    if user["role"] != "admin" and not (
        user["role"] == "team_lead" and existing["owner_id"] == user["id"]
    ):
        raise AuthError(403, "Insufficient role")

    body = ProjectPatch(**http.parse_json_body(event))
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise ValueError("body: at least one field is required")

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
    return http.ok(row, event)


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

