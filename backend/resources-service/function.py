"""resources-service — read/edit staffing metadata on ``users``.

There is **no** separate ``resources`` table. "Resources" is the view over
``users``. Admins manage role + staffing metadata (SYSTEM_DESIGN §5).

Default ``GET /api/resources-service`` returns the set of users that the UI
needs for the "pick a member" picker on /projects/:id — i.e. anyone who can
actually be staffed onto a project: ``team_lead`` and ``team_member``.
Admins and viewers are excluded (admins don't work on projects; viewers are
observers). Use ``?all=true`` to retrieve every user (admin-page directory).
"""

from __future__ import annotations

import logging
from typing import Any, Literal, Mapping

from pydantic import Field, ValidationError

from _lib import db, http
from _lib.auth import AuthError, current_user, handle_auth_errors, invalidate_user_cache, verify_token
from _lib.validation import StrictModel, first_error

_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)
_SERVICE = "resources-service"

# Roles an admin may PROMOTE/DEMOTE someone TO. Note the deliberate exclusion
# of ``admin``: admins cannot create more admins via the API (avoids
# accidental elevation), and cannot demote each other (see ``_patch``).
PromotableRole = Literal["viewer", "team_member", "team_lead"]


class ResourcePatch(StrictModel):
    """Body for ``PATCH /api/resources-service/{user_id}``."""

    is_allocatable: bool | None = None
    job_title: str | None = Field(default=None, max_length=120)
    weekly_capacity_hours: int | None = Field(default=None, ge=0, le=80)
    full_name: str | None = Field(default=None, max_length=200)
    # Admin-only field. Pydantic Literal rejects ``"admin"`` at parse time,
    # so the API cannot be used to elevate anyone TO admin.
    role: PromotableRole | None = None


def handler(event: Mapping[str, Any], context: Any = None) -> dict[str, Any]:
    """Lambda entrypoint."""
    if http.is_options(event):
        return http.no_content(event)
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "GET").upper()
    parts = http.path_parts(event, _SERVICE)
    try:
        if method == "GET" and parts == ["health"]:
            return http.ok({"status": "UP", "db": "UP" if db.health() else "DOWN"}, event)
        if method == "GET" and parts == ["me"]:
            # Returns the caller's own users row. Frontend uses this to learn
            # its own user_id so team_members can self-allocate to projects.
            return http.ok(current_user(event), event)
        if method == "GET" and not parts:
            verify_token(event)
            return _list(event)
        if method == "GET" and len(parts) == 1:
            verify_token(event)
            return _get(event, parts[0])
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


_PROJECTION = (
    "id, email, full_name, job_title, is_allocatable, "
    "weekly_capacity_hours, role, created_at, updated_at"
)


def _list(event: Mapping[str, Any]) -> dict[str, Any]:
    """List staffable users by default; ``?all=true`` returns everyone."""
    qs = http.query_params(event)
    limit = min(int(qs.get("limit", 50) or 50), 100)
    offset = max(int(qs.get("offset", 0) or 0), 0)
    # Default semantic: "who can be picked in the project allocations picker"
    # = team_lead + team_member. Admins are operators (not project workers);
    # viewers are observers. ``?all=true`` overrides for the admin directory.
    if qs.get("all") == "true":
        where = ""
    else:
        where = "WHERE role IN ('team_lead','team_member')"
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

    # Spec: admins manage all accounts EXCEPT other admins. Look up the
    # target and refuse if it's an admin row (covers both "demote another
    # admin" and "edit an admin's metadata" — admin accounts are operator-
    # managed out-of-band, not via the API).
    with db.get_conn().cursor() as cur:
        cur.execute("SELECT role, is_allocatable FROM users WHERE id = %s", (user_id,))
        target = cur.fetchone()
    if not target:
        return http.not_found(event=event)
    if target["role"] == "admin":
        raise AuthError(403, "Admin accounts cannot be modified via this endpoint")

    # ── viewer × is_allocatable invariant ──────────────────────────────────
    # Viewers are read-only observers — they must never appear in the
    # project allocations picker. Two invariants enforce this:
    #
    #   (a) If the resulting role is "viewer", is_allocatable is forced to
    #       False. This auto-clears the flag when someone is demoted from
    #       team_member→viewer without the operator having to remember to
    #       untick the box first.
    #   (b) If the resulting role is "viewer" AND the operator explicitly
    #       passed is_allocatable=True in the same request, we reject —
    #       silently flipping it would mask an operator bug.
    #
    # `resulting_role` reflects the post-update role (the incoming `role`
    # field if present, else the existing one). Same for `resulting_alloc`.
    resulting_role = fields.get("role", target["role"])
    if resulting_role == "viewer":
        if fields.get("is_allocatable") is True:
            raise ValueError("is_allocatable: viewers cannot be marked allocatable")
        # Force-clear regardless of what was (or wasn't) sent.
        fields["is_allocatable"] = False

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


def _delete(event: Mapping[str, Any], user_id: str) -> dict[str, Any]:
    """Admin-only account removal.

    Mirrors ``_patch``'s guardrails:
      * Caller must be ``admin``.
      * Target row must exist.
      * Target must NOT be another ``admin`` account — admin accounts are
        operator-managed out-of-band and cannot be deleted via the API to
        prevent accidental lock-out of the admin pool (a four-admin race
        could otherwise zero out the admin role for the whole tenant).
      * Callers may not delete themselves (belt-and-braces — the admin
        guard above already covers it since self is an admin row, but the
        explicit check produces a clearer 403 message).

    Cognito users are NOT removed — the user pool is the source of truth for
    authentication, and a re-login would otherwise resurrect a ``viewer`` row
    via :func:`_ensure_user`. Operators clean up Cognito separately when they
    truly want to revoke sign-in.
    """
    caller = current_user(event)
    if caller["role"] != "admin":
        raise AuthError(403, "Insufficient role")
    if caller["id"] == user_id:
        raise AuthError(403, "Admins cannot delete their own account")

    with db.get_conn().cursor() as cur:
        cur.execute("SELECT role, email FROM users WHERE id = %s", (user_id,))
        target = cur.fetchone()
    if not target:
        return http.not_found(event=event)
    if target["role"] == "admin":
        raise AuthError(403, "Admin accounts cannot be deleted via this endpoint")

    # FK behaviour (per migrations 001/002/003):
    #   projects.owner_id           → ON DELETE RESTRICT  (blocks deletion)
    #   allocations.user_id         → ON DELETE CASCADE
    #   assignments.user_id         → ON DELETE CASCADE
    #   equipment.assigned_user_id  → ON DELETE SET NULL
    #   audit_log.user_id           → ON DELETE SET NULL
    #   *.requested_by/approved_by  → ON DELETE SET NULL
    # The RESTRICT on owner_id means we must surface a useful 400 when the
    # target still owns projects, rather than leaking a Postgres
    # ForeignKeyViolation as a generic 500.
    import psycopg  # local import: handler hot-path doesn't need it
    with db.transaction() as conn, conn.cursor() as cur:
        try:
            cur.execute("DELETE FROM users WHERE id = %s RETURNING id", (user_id,))
        except psycopg.errors.ForeignKeyViolation as exc:
            raise ValueError(
                "user: cannot delete — they still own one or more projects. "
                "Reassign or delete those projects first."
            ) from exc
        if not cur.fetchone():
            return http.not_found(event=event)
        db.audit(conn, caller["id"], "resource.deleted", "user", user_id,
                 {"email": target["email"]})
    invalidate_user_cache(None)
    return http.no_content(event)


