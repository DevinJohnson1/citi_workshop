"""deliverables-service — CRUD for the ``deliverables`` table.

Note: the table has no ``assignee_id`` column. ``?assigned_to=`` filters by
joining the ``assignments`` table (SYSTEM_DESIGN §7).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Mapping, get_args

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.validation import DeliverableStatus, StrictModel, first_error

_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)
_SERVICE = "deliverables-service"
_STATUS: frozenset[str] = frozenset(get_args(DeliverableStatus))


class DeliverableCreate(StrictModel):
    """Body for ``POST /api/deliverables-service``."""

    project_id: str
    title: str = Field(min_length=1, max_length=200)
    status: DeliverableStatus = "todo"
    due_date: date | None = None
    depends_on: str | None = None


class DeliverablePatch(StrictModel):
    """Body for ``PATCH /api/deliverables-service/{id}``."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: DeliverableStatus | None = None
    due_date: date | None = None
    depends_on: str | None = None


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
    join = ""
    if pid := qs.get("project_id"):
        where.append("d.project_id = %s")
        params.append(pid)
    if status := qs.get("status"):
        if status not in _STATUS:
            raise ValueError(f"status: must be one of {sorted(_STATUS)}")
        where.append("d.status = %s")
        params.append(status)
    if assignee := qs.get("assigned_to"):
        join = "JOIN assignments a ON a.deliverable_id = d.id"
        where.append("a.user_id = %s AND a.completed_at IS NULL")
        params.append(assignee)
    if q := qs.get("q"):
        where.append("LOWER(d.title) LIKE %s")
        params.append(f"%{q.lower()}%")

    limit = min(int(qs.get("limit", 20) or 20), 100)
    offset = max(int(qs.get("offset", 0) or 0), 0)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(DISTINCT d.id) AS n FROM deliverables d {join} {where_sql}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT DISTINCT d.* FROM deliverables d {join} {where_sql} "
            f"ORDER BY d.created_at DESC LIMIT %s OFFSET %s",
            (*params, limit, offset),
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], deliverable_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM deliverables WHERE id = %s", (deliverable_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(row, event)


def _project_owner(conn, project_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
    return row["owner_id"] if row else None


def _create(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    body = DeliverableCreate(**http.parse_json_body(event))
    conn = db.get_conn()
    owner = _project_owner(conn, body.project_id)
    if owner is None:
        return http.not_found("Project not found", event)
    if user["role"] != "admin" and not (user["role"] == "team_lead" and owner == user["id"]):
        raise AuthError(403, "Insufficient role")

    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO deliverables (project_id, title, status, due_date, depends_on)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (body.project_id, body.title, body.status, body.due_date, body.depends_on),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "deliverable.created", "deliverable", row["id"],
                 {"title": row["title"], "project_id": body.project_id})
    return http.created(row, event)


def _can_patch(user: dict, owner_id: str | None, deliverable_id: str, body: "DeliverablePatch") -> bool:
    """Status-only updates are allowed for any user with an open assignment."""
    if user["role"] == "admin":
        return True
    if user["role"] == "team_lead" and owner_id == user["id"]:
        return True
    set_fields = body.model_dump(exclude_unset=True)
    if set(set_fields.keys()) == {"status"}:
        conn = db.get_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM assignments WHERE deliverable_id = %s AND user_id = %s "
                "AND completed_at IS NULL LIMIT 1",
                (deliverable_id, user["id"]),
            )
            return cur.fetchone() is not None
    return False


def _patch(event: Mapping[str, Any], deliverable_id: str) -> dict[str, Any]:
    user = current_user(event)
    body = DeliverablePatch(**http.parse_json_body(event))
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ValueError("body: at least one field is required")

    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT d.id, p.owner_id FROM deliverables d "
            "JOIN projects p ON p.id = d.project_id WHERE d.id = %s",
            (deliverable_id,),
        )
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    if not _can_patch(user, existing["owner_id"], deliverable_id, body):
        raise AuthError(403, "Insufficient role")

    set_sql = ", ".join(f"{k} = %s" for k in fields)
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE deliverables SET {set_sql} WHERE id = %s RETURNING *",
            (*fields.values(), deliverable_id),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "deliverable.updated", "deliverable", deliverable_id, fields)
    return http.ok(row, event)


def _delete(event: Mapping[str, Any], deliverable_id: str) -> dict[str, Any]:
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT p.owner_id FROM deliverables d JOIN projects p ON p.id = d.project_id "
            "WHERE d.id = %s",
            (deliverable_id,),
        )
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    if user["role"] != "admin" and not (user["role"] == "team_lead" and existing["owner_id"] == user["id"]):
        raise AuthError(403, "Insufficient role")
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM deliverables WHERE id = %s", (deliverable_id,))
        db.audit(conn, user["id"], "deliverable.deleted", "deliverable", deliverable_id, None)
    return http.no_content(event)

