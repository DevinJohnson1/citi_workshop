"""resources-service — read/edit staffing metadata on ``users``.

There is **no** separate ``resources`` table. "Resources" is the view over
``users WHERE is_allocatable = true``. Admins flip ``is_allocatable``, set
``job_title`` and ``weekly_capacity_hours`` (SYSTEM_DESIGN §5).
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, invalidate_user_cache, verify_token
from _lib.validation import StrictModel, first_error

_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)
_SERVICE = "resources-service"


class ResourcePatch(StrictModel):
    """Body for ``PATCH /api/resources-service/{user_id}``."""

    is_allocatable: bool | None = None
    job_title: str | None = Field(default=None, max_length=120)
    weekly_capacity_hours: int | None = Field(default=None, ge=0, le=80)
    full_name: str | None = Field(default=None, max_length=200)


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
        if method == "PATCH" and len(parts) == 1:
            return _patch(event, parts[0])
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


_PROJECTION = (
    "id, email, full_name, job_title, is_allocatable, "
    "weekly_capacity_hours, role, created_at, updated_at"
)


def _list(event: Mapping[str, Any]) -> dict[str, Any]:
    """List allocatable users by default; ``?all=true`` includes everyone."""
    qs = http.query_params(event)
    limit = min(int(qs.get("limit", 50) or 50), 100)
    offset = max(int(qs.get("offset", 0) or 0), 0)
    where = "" if qs.get("all") == "true" else "WHERE is_allocatable"
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM users {where}")
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT {_PROJECTION} FROM users {where} "
            f"ORDER BY full_name NULLS LAST, email LIMIT %s OFFSET %s",
            (limit, offset),
        )
        rows = cur.fetchall()
    return http.ok({"data": rows, "meta": {"total": total, "limit": limit, "offset": offset}}, event)


def _get(event: Mapping[str, Any], user_id: str) -> dict[str, Any]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PROJECTION} FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    if not row:
        return http.not_found(event=event)
    return http.ok(row, event)


def _patch(event: Mapping[str, Any], user_id: str) -> dict[str, Any]:
    user = current_user(event)
    if user["role"] != "admin":
        raise AuthError(403, "Insufficient role")
    body = ResourcePatch(**http.parse_json_body(event))
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ValueError("body: at least one field is required")
    set_sql = ", ".join(f"{k} = %s" for k in fields)
    with db.transaction() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE users SET {set_sql} WHERE id = %s RETURNING {_PROJECTION}",
            (*fields.values(), user_id),
        )
        row = cur.fetchone()
        if not row:
            return http.not_found(event=event)
        db.audit(conn, user["id"], "resource.updated", "user", user_id, fields)
    # Drop any cached ``users`` row globally — we mutated one by primary key,
    # not by ``cognito_sub``, so the cheapest correct invalidation is to clear
    # the whole map. Admin-only endpoint; volume is negligible.
    invalidate_user_cache(None)
    return http.ok(row, event)

