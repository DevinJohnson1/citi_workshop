"""HTTP helpers for Lambda Function URL (payload v2.0) responses.

All handlers should use these helpers so the response shape, CORS headers,
and error envelope stay consistent across services per SYSTEM_DESIGN §7.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Mapping

# Origins allowed by CORS. CloudFront domain is injected via env at deploy time;
# localhost:3000 covers Vite dev.
_ALLOWED_ORIGINS = {
    o.strip()
    for o in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
}


def cors_headers(event: Mapping[str, Any] | None = None) -> dict[str, str]:
    """Return CORS headers, echoing the request Origin only when allow-listed.

    Per SYSTEM_DESIGN §9 we never reply with ``*`` in production. We also do
    **not** fall back to an arbitrary configured origin when the caller's
    ``Origin`` is unknown — emitting the wrong allow-origin would either mask
    a misconfiguration or, worse, signal to the browser that a foreign site
    is trusted. When the origin is not on the allow-list we simply omit the
    ``Access-Control-Allow-Origin`` header, which causes the browser to block
    the response. That is the correct behavior.
    """
    origin = ""
    if event:
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        origin = headers.get("origin", "")

    base: dict[str, str] = {
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "false",
        "Vary": "Origin",
    }
    if origin and origin in _ALLOWED_ORIGINS:
        base["Access-Control-Allow-Origin"] = origin
    return base


def _response(
    status: int,
    body: Any,
    event: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a Function URL v2.0 response with JSON body and CORS headers."""
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **cors_headers(event)},
        "body": json.dumps(body, default=str),
    }


def ok(body: Any, event: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """200 OK with a JSON body."""
    return _response(200, body, event)


def created(body: Any, event: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """201 Created with a JSON body."""
    return _response(201, body, event)


def no_content(event: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """204 No Content with CORS headers only."""
    return {"statusCode": 204, "headers": cors_headers(event), "body": ""}


def _error(status: int, slug: str, message: str, event: Mapping[str, Any] | None) -> dict[str, Any]:
    return _response(
        status,
        {
            "error": slug,
            "message": message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
        event,
    )


def bad_request(message: str, event: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """400 with the ``BAD_REQUEST`` slug."""
    return _error(400, "BAD_REQUEST", message, event)


def unauthorized(
    message: str = "Authentication required",
    event: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """401 with the ``UNAUTHORIZED`` slug."""
    return _error(401, "UNAUTHORIZED", message, event)


def forbidden(
    message: str = "Insufficient role",
    event: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """403 with the ``FORBIDDEN`` slug."""
    return _error(403, "FORBIDDEN", message, event)


def not_found(
    message: str = "Resource not found",
    event: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """404 with the ``NOT_FOUND`` slug."""
    return _error(404, "NOT_FOUND", message, event)


def error(
    message: str = "Internal server error",
    event: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """500 with the ``INTERNAL_SERVER_ERROR`` slug. Caller logs full detail."""
    return _error(500, "INTERNAL_SERVER_ERROR", message, event)


def is_options(event: Mapping[str, Any]) -> bool:
    """True if the Function URL event is a CORS preflight."""
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "")
    return method.upper() == "OPTIONS"


def parse_json_body(event: Mapping[str, Any]) -> dict[str, Any]:
    """Decode the request body as JSON, raising ``ValueError`` on malformed input."""
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64

        raw = base64.b64decode(raw).decode("utf-8")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Malformed request body") from exc
    if not isinstance(parsed, dict):
        raise ValueError("Malformed request body")
    return parsed


def query_params(event: Mapping[str, Any]) -> dict[str, str]:
    """Return query string parameters as a flat dict (empty if none)."""
    return dict(event.get("queryStringParameters") or {})


def path_parts(event: Mapping[str, Any], service: str) -> list[str]:
    """Return path segments after ``/api/<service>``.

    Example: for ``/api/projects-service/abc/items`` → ``["abc", "items"]``.
    """
    raw_path: str = event.get("rawPath", "") or ""
    prefix = f"/api/{service}"
    tail = raw_path[len(prefix):] if raw_path.startswith(prefix) else raw_path
    return [p for p in tail.split("/") if p]

