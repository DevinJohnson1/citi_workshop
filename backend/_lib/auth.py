"""JWT verification + RBAC for Lambda handlers.

Validates Cognito access tokens (iss, aud, exp, ``token_use``, signature
via cached JWKS) on every invocation. Cognito must be deployed in the
target environment (real AWS or LocalStack Pro with
``var.enable_cognito=true``).
"""

from __future__ import annotations

import functools
import logging
import os
import time
from typing import Any, Callable, Mapping

import jwt
from jwt import PyJWKClient

from . import db, http

_LOG = logging.getLogger(__name__)

_ISSUER = os.getenv("COGNITO_ISSUER_URL", "")
_CLIENT_ID = os.getenv("COGNITO_CLIENT_ID", "")
# Optional override for the JWKS endpoint. Needed on LocalStack because the
# `iss` claim points at `localhost.localstack.cloud` (reachable from the
# browser) while the Lambda container has to dial `workshop-localstack`.
_JWKS_URL = os.getenv("COGNITO_JWKS_URL", "")

# Workshop seed accounts created by bin/seed-cognito.sh. When one of these
# emails logs in for the first time we stamp the matching role on the DB row
# so the four pre-baked personas have the right permissions out of the box.
# Real (non-seed) users default to the schema's "viewer" role.
_SEED_ROLES: dict[str, str] = {
    "admin@workshop.local": "admin",
    "lead@workshop.local": "team_lead",
    "member@workshop.local": "team_member",
    "viewer@workshop.local": "viewer",
}

_JWKS_CLIENT: PyJWKClient | None = None
_JWKS_LAST_REFRESH: float = 0.0
_JWKS_TTL_SECONDS = 3600

# Module-scoped cache of resolved ``users`` rows keyed by ``cognito_sub``.
# Each authenticated request used to run an upsert against ``users``; under
# any read-heavy workload that was a write per request. The cache is keyed by
# ``cognito_sub`` (claim is immutable per Cognito user) with a short TTL so
# operator-level role changes still take effect within minutes.
_USER_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_USER_CACHE_TTL_SECONDS = int(os.getenv("USER_CACHE_TTL_SECONDS", "300"))


class AuthError(Exception):
    """Raised when the request lacks a valid token or required role."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _jwks_client() -> PyJWKClient:
    """Lazily build (and periodically refresh) the JWKS client."""
    global _JWKS_CLIENT, _JWKS_LAST_REFRESH
    now = time.time()
    if _JWKS_CLIENT is None or now - _JWKS_LAST_REFRESH > _JWKS_TTL_SECONDS:
        if not _ISSUER:
            raise AuthError(500, "COGNITO_ISSUER_URL is not configured")
        jwks_url = _JWKS_URL or f"{_ISSUER}/.well-known/jwks.json"
        _JWKS_CLIENT = PyJWKClient(jwks_url)
        _JWKS_LAST_REFRESH = now
    return _JWKS_CLIENT


def _extract_bearer(event: Mapping[str, Any]) -> str:
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    auth = headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise AuthError(401, "Authentication required")
    return auth.split(" ", 1)[1].strip()


def verify_token(event: Mapping[str, Any]) -> dict[str, Any]:
    """Verify the Cognito access token on ``event`` and return its claims.

    Raises :class:`AuthError` on any failure.
    """
    token = _extract_bearer(event)
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=_ISSUER,
            options={"require": ["exp", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        _LOG.warning("JWT verification failed: %s", exc)
        raise AuthError(401, "Authentication required") from exc

    if claims.get("token_use") != "access":
        raise AuthError(401, "Authentication required")
    # Cognito access tokens encode the app client id in ``client_id``.
    if _CLIENT_ID and claims.get("client_id") and claims["client_id"] != _CLIENT_ID:
        raise AuthError(401, "Authentication required")
    return claims


def current_user(event: Mapping[str, Any]) -> dict[str, Any]:
    """Return the ``users`` row for the caller, upserting on first login."""
    claims = verify_token(event)
    sub = claims["sub"]
    email = claims.get("email", "")

    cached = _USER_CACHE.get(sub)
    if cached is not None:
        cached_at, row = cached
        if time.time() - cached_at < _USER_CACHE_TTL_SECONDS:
            return row

    # Seed users get their canonical role; everyone else falls back to "viewer".
    role = _SEED_ROLES.get(email.lower(), "viewer")
    row = _ensure_user(sub, email, role)
    _USER_CACHE[sub] = (time.time(), row)
    return row


def invalidate_user_cache(cognito_sub: str | None = None) -> None:
    """Drop a single cached user row, or the whole cache when ``sub`` is ``None``.

    Call this from any handler that mutates ``users`` (role, ``is_allocatable``,
    etc.) so the next request sees the change without waiting for TTL expiry.
    """
    if cognito_sub is None:
        _USER_CACHE.clear()
    else:
        _USER_CACHE.pop(cognito_sub, None)


def _ensure_user(cognito_sub: str, email: str, default_role: str = "viewer") -> dict[str, Any]:
    """Upsert the ``users`` row keyed by ``cognito_sub`` and return it.

    For seed accounts (see :data:`_SEED_ROLES`) the role is reapplied on every
    login so an operator who mutates the row manually still ends up with the
    canonical workshop persona on the next request.
    """
    conn = db.get_conn()
    is_seed = email.lower() in _SEED_ROLES
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO users (cognito_sub, email, role)
            VALUES (%s, %s, %s)
            ON CONFLICT (cognito_sub) DO UPDATE
                SET email = EXCLUDED.email,
                    role  = CASE WHEN %s THEN EXCLUDED.role ELSE users.role END
            RETURNING id, cognito_sub, email, full_name, job_title,
                      is_allocatable, weekly_capacity_hours, role
            """,
            (cognito_sub, email, default_role, is_seed),
        )
        row = cur.fetchone()
        return dict(row)


def require_role(*roles: str) -> Callable:
    """Decorator: ensure ``current_user`` has one of ``roles`` before the handler.

    Usage::

        @require_role("admin", "team_lead")
        def create_project(event, user): ...
    """
    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(event: Mapping[str, Any], *args, **kwargs):
            user = current_user(event)
            if user["role"] not in roles:
                raise AuthError(403, "Insufficient role")
            return fn(event, user, *args, **kwargs)

        return wrapper

    return decorator


def handle_auth_errors(event: Mapping[str, Any], exc: AuthError) -> dict[str, Any]:
    """Convert an :class:`AuthError` into a JSON HTTP response."""
    if exc.status == 401:
        return http.unauthorized(exc.message, event)
    if exc.status == 403:
        return http.forbidden(exc.message, event)
    return http.error(exc.message, event)

