"""JWT verification + RBAC for Lambda handlers.
Validates Cognito access/ID tokens (iss, aud, exp, ``token_use``, signature
via cached JWKS) on every invocation. Cognito must be deployed in the target
environment (real AWS or LocalStack Pro with ``var.enable_cognito=true``).
"""
from __future__ import annotations
import functools
import os
import time
from typing import Any, Callable, Mapping
import jwt
from jwt import PyJWKClient
from . import db, http
_ISSUER = os.getenv("COGNITO_ISSUER_URL", "")
_CLIENT_ID = os.getenv("COGNITO_CLIENT_ID", "")
# Optional override for the JWKS endpoint. Needed on LocalStack because the
# `iss` claim points at `localhost.localstack.cloud` (reachable from the
# browser) while the Lambda container has to dial `workshop-localstack`.
_JWKS_URL = os.getenv("COGNITO_JWKS_URL", "")
# Workshop seed accounts (see bin/seed-cognito.sh). On first login we stamp
# the matching role on the DB row; real users default to "viewer".
_SEED_ROLES: dict[str, str] = {
    # Legacy workshop personas (shared $WORKSHOP_PASSWORD).
    "admin@workshop.local": "admin",
    "lead@workshop.local": "team_lead",
    "member@workshop.local": "team_member",
    "viewer@workshop.local": "viewer",
    # ACME team leads (10).
    "olivia.bennett@acme.org": "team_lead",
    "marcus.chen@acme.org": "team_lead",
    "priya.raman@acme.org": "team_lead",
    "jonas.weber@acme.org": "team_lead",
    "amelia.foster@acme.org": "team_lead",
    "diego.alvarez@acme.org": "team_lead",
    "sasha.petrova@acme.org": "team_lead",
    "ravi.subramanian@acme.org": "team_lead",
    "hannah.klein@acme.org": "team_lead",
    "tobias.larsen@acme.org": "team_lead",
    # ACME team members (30).
    "liam.carter@acme.org": "team_member",
    "emma.donovan@acme.org": "team_member",
    "noah.patel@acme.org": "team_member",
    "ava.rodriguez@acme.org": "team_member",
    "ethan.nakamura@acme.org": "team_member",
    "mia.johansson@acme.org": "team_member",
    "lucas.brennan@acme.org": "team_member",
    "sophia.mwangi@acme.org": "team_member",
    "mason.reilly@acme.org": "team_member",
    "isabella.park@acme.org": "team_member",
    "logan.whitaker@acme.org": "team_member",
    "charlotte.singh@acme.org": "team_member",
    "benjamin.holloway@acme.org": "team_member",
    "amelia.castillo@acme.org": "team_member",
    "elijah.okafor@acme.org": "team_member",
    "harper.lindgren@acme.org": "team_member",
    "james.underwood@acme.org": "team_member",
    "evelyn.tanaka@acme.org": "team_member",
    "alexander.boyd@acme.org": "team_member",
    "abigail.fischer@acme.org": "team_member",
    "daniel.romano@acme.org": "team_member",
    "emily.hartman@acme.org": "team_member",
    "henry.delacroix@acme.org": "team_member",
    "scarlett.novak@acme.org": "team_member",
    "sebastian.ortega@acme.org": "team_member",
    "lily.karlsson@acme.org": "team_member",
    "jackson.ibarra@acme.org": "team_member",
    "grace.sullivan@acme.org": "team_member",
    "owen.marchetti@acme.org": "team_member",
    "zoe.halvorsen@acme.org": "team_member",
}
_JWKS_CLIENT: PyJWKClient | None = None
_JWKS_LAST_REFRESH: float = 0.0
_JWKS_TTL_SECONDS = 3600
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
    """Verify a Cognito JWT (ID **or** access token) and return its claims.
    ID tokens bind via ``aud``; access tokens via ``client_id``. PyJWT's
    ``verify_aud`` is disabled so we can branch on ``token_use`` without it
    raising on access tokens that legitimately lack ``aud``.
    """
    token = _extract_bearer(event)
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=_ISSUER,
            options={"require": ["exp", "iss", "sub"], "verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise AuthError(401, "Authentication required") from exc
    token_use = claims.get("token_use")
    if token_use == "id":  # nosec B105 - Cognito token_use claim value, not a password
        if _CLIENT_ID:
            aud = claims.get("aud")
            if aud != _CLIENT_ID and not (isinstance(aud, list) and _CLIENT_ID in aud):
                raise AuthError(401, "Authentication required")
    elif token_use == "access":  # nosec B105 - Cognito token_use claim value, not a password
        if _CLIENT_ID and claims.get("client_id") and claims["client_id"] != _CLIENT_ID:
            raise AuthError(401, "Authentication required")
    else:
        raise AuthError(401, "Authentication required")
    return claims
def current_user(event: Mapping[str, Any]) -> dict[str, Any]:
    """Verify the JWT and return the canonical ``users`` row for the caller.
    The SPA must send the Cognito ID token (access tokens omit ``email``
    under the pool's ``username_attributes=["email"]`` config). No in-process
    user cache — one upsert per request is fine at workshop scale and avoids
    stale-row bugs across LocalStack hot reloads.
    """
    claims = verify_token(event)
    sub = claims["sub"]
    email = (claims.get("email") or "").strip()
    if not email:
        raise AuthError(
            401,
            "Token missing email claim; the SPA must send the Cognito ID token.",
        )
    role = _SEED_ROLES.get(email.lower(), "viewer")
    return _ensure_user(sub, email, role)
def _ensure_user(cognito_sub: str, email: str, default_role: str = "viewer") -> dict[str, Any]:
    """Upsert the ``users`` row keyed by ``email`` and return it.
    Conflict target is ``email`` (not ``cognito_sub``) so personas pre-seeded
    by migration 002 — with a ``pending:<email>`` sentinel sub — are
    atomically upgraded on first login. Seed-account roles are reapplied
    every login; team_lead / team_member rows are auto-flagged allocatable.
    The defensive UPDATE quarantines any leftover row already holding our
    ``cognito_sub`` under a different email — would otherwise trigger a
    UNIQUE-violation on the upsert. Quarantine, not delete, to preserve FK
    references (``projects.owner_id`` is ON DELETE RESTRICT).
    """
    conn = db.get_conn()
    is_seed = email.lower() in _SEED_ROLES
    staff_role = default_role in {"team_lead", "team_member"}
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "UPDATE users "
            "   SET cognito_sub = 'deleted:' || cognito_sub, "
            "       email       = 'deleted:' || email "
            " WHERE cognito_sub = %s AND email <> %s "
            "   AND cognito_sub NOT LIKE 'deleted:%%'",
            (cognito_sub, email),
        )
        cur.execute(
            """
            INSERT INTO users (cognito_sub, email, role, is_allocatable)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (email) DO UPDATE
                SET cognito_sub    = EXCLUDED.cognito_sub,
                    role           = CASE WHEN %s THEN EXCLUDED.role ELSE users.role END,
                    is_allocatable = users.is_allocatable OR EXCLUDED.is_allocatable
            RETURNING id, cognito_sub, email, full_name, job_title,
                      is_allocatable, weekly_capacity_hours, role
            """,
            (cognito_sub, email, default_role, staff_role, is_seed),
        )
        return dict(cur.fetchone())
def require_role(*roles: str) -> Callable:
    """Decorator: ensure ``current_user`` has one of ``roles``.
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
