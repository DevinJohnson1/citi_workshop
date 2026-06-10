"""allocations-service — CRUD on project-level capacity (``allocations``).

Warns on over-allocation (Σ percent > 100 in any overlapping window) but
never blocks. The reports-service computes the formal over-allocated /
over-assigned reports.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Mapping

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, verify_token
from _lib.validation import StrictModel, first_error

_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)
_SERVICE = "allocations-service"


class AllocationCreate(StrictModel):
    """Body for ``POST /api/allocations-service``."""

    user_id: str
    project_id: str
    percent: int = Field(ge=1, le=100)
    start_date: date
    end_date: date


class AllocationPatch(StrictModel):
    """Body for ``PATCH /api/allocations-service/{id}``."""

    percent: int | None = Field(default=None, ge=1, le=100)
    start_date: date | None = None
    end_date: date | None = None


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
    limit = min(int(qs.get("limit", 20) or 20), 100)
    offset = max(int(qs.get("offset", 0) or 0), 0)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM allocations {where_sql}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT * FROM allocations {where_sql} "
            f"ORDER BY start_date DESC LIMIT %s OFFSET %s",
            (*params, limit, offset),
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], allocation_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM allocations WHERE id = %s", (allocation_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(row, event)


def _ensure_lead_can_write(user: dict, project_id: str) -> None:
    if user["role"] == "admin":
        return
    if user["role"] != "team_lead":
        raise AuthError(403, "Insufficient role")
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT owner_id FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
    if not row or row["owner_id"] != user["id"]:
        raise AuthError(403, "Insufficient role")


def _overlap_warning(conn, user_id: str, start: date, end: date, percent: int,
                     exclude_id: str | None = None) -> int:
    """Return the max overlapping percent for ``user_id`` across the window."""
    extra_sql = " AND id <> %s" if exclude_id else ""
    extra_params: tuple = (exclude_id,) if exclude_id else ()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT COALESCE(SUM(percent), 0) AS pct
            FROM allocations
            WHERE user_id = %s
              AND start_date <= %s
              AND end_date   >= %s
              {extra_sql}
            """,
            (user_id, end, start, *extra_params),
        )
        existing = cur.fetchone()["pct"] or 0
    return int(existing) + percent


def _create(event: Mapping[str, Any]) -> dict[str, Any]:
    user = current_user(event)
    body = AllocationCreate(**http.parse_json_body(event))
    if body.end_date < body.start_date:
        raise ValueError("end_date: must be on or after start_date")
    _ensure_lead_can_write(user, body.project_id)
    with db.transaction() as conn, conn.cursor() as cur:
        warning_pct = _overlap_warning(conn, body.user_id, body.start_date,
                                       body.end_date, body.percent)
        cur.execute(
            """
            INSERT INTO allocations (user_id, project_id, percent, start_date, end_date)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (body.user_id, body.project_id, body.percent, body.start_date, body.end_date),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "allocation.created", "allocation", row["id"],
                 {"user_id": body.user_id, "project_id": body.project_id,
                  "overlap_pct": warning_pct})
    payload = dict(row)
    if warning_pct > 100:
        payload["warning"] = f"User over-allocated: total {warning_pct}% in this window"
    return http.created(payload, event)


def _patch(event: Mapping[str, Any], allocation_id: str) -> dict[str, Any]:
    user = current_user(event)
    body = AllocationPatch(**http.parse_json_body(event))
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ValueError("body: at least one field is required")
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM allocations WHERE id = %s", (allocation_id,))
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    _ensure_lead_can_write(user, existing["project_id"])
    start = fields.get("start_date", existing["start_date"])
    end = fields.get("end_date", existing["end_date"])
    if end < start:
        raise ValueError("end_date: must be on or after start_date")
    set_sql = ", ".join(f"{k} = %s" for k in fields)
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE allocations SET {set_sql} WHERE id = %s RETURNING *",
            (*fields.values(), allocation_id),
        )
        row = cur.fetchone()
        db.audit(conn, user["id"], "allocation.updated", "allocation", allocation_id, fields)
    return http.ok(row, event)


def _delete(event: Mapping[str, Any], allocation_id: str) -> dict[str, Any]:
    user = current_user(event)
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT project_id FROM allocations WHERE id = %s", (allocation_id,))
        existing = cur.fetchone()
    if not existing:
        return http.not_found(event=event)
    _ensure_lead_can_write(user, existing["project_id"])
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM allocations WHERE id = %s", (allocation_id,))
        db.audit(conn, user["id"], "allocation.deleted", "allocation", allocation_id, None)
    return http.no_content(event)

