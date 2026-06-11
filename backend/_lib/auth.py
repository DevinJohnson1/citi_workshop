"""JWT verification + RBAC for Lambda handlers.
Validates Cognito access/ID tokens (iss, aud, exp, ``token_use``, signature
via cached JWKS) on every invocation. Cognito must be deployed in the target
environment (real AWS or LocalStack Pro with ``var.enable_cognito=true``).
"""
from __future__ import annotations
import base64
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
# DEV-ONLY ESCAPE HATCH. When AUTH_DEV_BYPASS=true the backend accepts
# bearer tokens of the form ``dev-bypass.<email>.<nonce>`` for the legacy
# seed personas (admin/lead/member/viewer @workshop.local) without any
# cryptographic verification. Anyone who can reach a Lambda URL can mint
# such a token and sign in as admin — only enable in workshop deployments
# where the four seed accounts already share a single shared password.
# Toggle via Terraform var ``enable_dev_auth_bypass`` → Lambda env var.
_DEV_BYPASS = os.getenv("AUTH_DEV_BYPASS", "").strip().lower() == "true"
_DEV_BYPASS_PREFIX = "dev-bypass."
_DEV_BYPASS_EMAILS: frozenset[str] = frozenset({
    "admin@workshop.local",
    "lead@workshop.local",
    "member@workshop.local",
    "viewer@workshop.local",
})
# Shared plaintext password the SPA must embed in every bypass token. Wired
# from Terraform var.workshop_password → Lambda env. Compared verbatim, no
# hashing — see SECURITY note on _verify_dev_bypass below.
_WORKSHOP_PASSWORD = os.getenv("WORKSHOP_PASSWORD", "")
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
def _verify_dev_bypass(token: str) -> dict[str, Any]:
    """Synthesize claims for a ``dev-bypass.<email>.<b64-password>.<nonce>`` token.

    SECURITY: the password is compared as plaintext against
    ``WORKSHOP_PASSWORD`` (no hashing). Any sniffer or anyone with access to
    the deployed JS bundle can extract this value — treat it as friction, not
    as security. Logs to CloudWatch on every use so misuse in prod is visible.
    Rejects anything outside the four hard-coded legacy seed emails.
    """
    parts = token.split(".", 3)
    if len(parts) < 4:
        raise AuthError(401, "Authentication required")
    email = parts[1].strip().lower()
    if email not in _DEV_BYPASS_EMAILS:
        raise AuthError(401, "Authentication required")
    try:
        provided_password = base64.urlsafe_b64decode(parts[2] + "===").decode("utf-8")
    except (ValueError, UnicodeDecodeError) as exc:
        raise AuthError(401, "Authentication required") from exc
    expected = _WORKSHOP_PASSWORD
    if not expected or provided_password != expected:
        print(f"[auth] AUTH_DEV_BYPASS password mismatch for {email!r}")
        raise AuthError(401, "Invalid credentials")
    print(f"[auth] AUTH_DEV_BYPASS in use for {email!r} — NOT FOR PRODUCTION")
    return {
        "sub": f"dev-bypass:{email}",
        "email": email,
        "token_use": "id",
        "iss": _ISSUER or "dev-bypass",
        "aud": _CLIENT_ID or "dev-bypass",
        "exp": int(time.time()) + 3600,
    }
def verify_token(event: Mapping[str, Any]) -> dict[str, Any]:
    """Verify a Cognito JWT (ID **or** access token) and return its claims.
    ID tokens bind via ``aud``; access tokens via ``client_id``. PyJWT's
    ``verify_aud`` is disabled so we can branch on ``token_use`` without it
    raising on access tokens that legitimately lack ``aud``.

    When ``AUTH_DEV_BYPASS=true`` is set in the Lambda env, tokens of the
    form ``dev-bypass.<email>.<nonce>`` are accepted for the four legacy
    seed personas WITHOUT any cryptographic verification. See module
    docstring on ``_DEV_BYPASS``.
    """
    token = _extract_bearer(event)
    if _DEV_BYPASS and token.startswith(_DEV_BYPASS_PREFIX):
        return _verify_dev_bypass(token)
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
