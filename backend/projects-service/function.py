"""projects-service — CRUD for the ``projects`` table.

Function URL payload v2.0. Dispatches purely on
``event['requestContext']['http']['method']`` + ``event['rawPath']``;
no web framework on Lambda (SYSTEM_DESIGN §0).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Mapping, get_args

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.validation import ProjectStatus, StrictModel, first_error

_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)

_SERVICE = "projects-service"
_SORTABLE = {"name", "status", "start_date", "target_end_date", "created_at"}
# Derived from the pydantic type so we never drift from the schema's CHECK
# constraint when validating ``?status=`` on the list endpoint.
_ALLOWED_STATUS: frozenset[str] = frozenset(get_args(ProjectStatus))


class ProjectCreate(StrictModel):
    """Body for ``POST /api/projects-service``."""

    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    status: ProjectStatus = "planned"
    start_date: date | None = None
    target_end_date: date | None = None


class ProjectPatch(StrictModel):
    """Body for ``PATCH /api/projects-service/{id}``. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: ProjectStatus | None = None
    start_date: date | None = None
    target_end_date: date | None = None
    actual_end_date: date | None = None


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
        where.append("target_end_date < (CURRENT_DATE + INTERVAL '14 days') "
                     "AND status NOT IN ('done','cancelled')")

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
            f"SELECT * FROM projects {where_sql} "
            f"ORDER BY {sort} {order} LIMIT %s OFFSET %s",
            (*params, limit, offset),
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(row, event)


def _create(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    if user["role"] not in {"admin", "team_lead"}:
        raise AuthError(403, "Insufficient role")
    body = ProjectCreate(**http.parse_json_body(event))

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO projects (name, description, status, start_date,
                                  target_end_date, owner_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (body.name, body.description, body.status, body.start_date,
             body.target_end_date, user["id"]),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "project.created", "project", row["id"], {"name": row["name"]})
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

    set_sql = ", ".join(f"{k} = %s" for k in fields)
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE projects SET {set_sql} WHERE id = %s RETURNING *",
            (*fields.values(), project_id),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "project.updated", "project", project_id, fields)
    return http.ok(row, event)


def _delete(event: Mapping[str, Any], project_id: str) -> dict[str, Any]:
    user = current_user(event)
    if user["role"] != "admin":
        raise AuthError(403, "Insufficient role")
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM projects WHERE id = %s RETURNING id", (project_id,))
        if not cur.fetchone():
            return http.not_found(event=event)
        db.audit(conn, user["id"], "project.deleted", "project", project_id, None)
    return http.no_content(event)


if __name__ == "__main__":
    # Lightweight local invocation for ad-hoc debugging.
    print(handler({"requestContext": {"http": {"method": "GET"}}, "rawPath": f"/api/{_SERVICE}/health"}))

