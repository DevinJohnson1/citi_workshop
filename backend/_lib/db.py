"""PostgreSQL connection helpers.

A single ``psycopg`` connection is cached at module level so warm Lambda
invocations reuse the socket. On any error the connection is reset so the
next invocation reconnects (SYSTEM_DESIGN §5).
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

_LOG = logging.getLogger(__name__)

_CONN: psycopg.Connection | None = None

# Server-side guard rails. ``statement_timeout`` bounds any single query so a
# runaway never outlives the Lambda invocation; ``idle_in_transaction_session_timeout``
# protects against a half-finished transaction holding an MVCC snapshot if the
# Lambda is frozen mid-handler. Values are in milliseconds.
_STATEMENT_TIMEOUT_MS = os.getenv("POSTGRES_STATEMENT_TIMEOUT_MS", "10000")
_IDLE_TX_TIMEOUT_MS = os.getenv("POSTGRES_IDLE_TX_TIMEOUT_MS", "30000")


def _conninfo() -> str:
    """Build a libpq conninfo string from POSTGRES_* env vars."""
    options = (
        f"-c statement_timeout={_STATEMENT_TIMEOUT_MS} "
        f"-c idle_in_transaction_session_timeout={_IDLE_TX_TIMEOUT_MS}"
    )
    return (
        f"host={os.getenv('POSTGRES_HOST', 'localhost')} "
        f"port={os.getenv('POSTGRES_PORT', '5432')} "
        f"user={os.getenv('POSTGRES_USER', 'postgres')} "
        f"password={os.getenv('POSTGRES_PASS', 'postgres123')} "
        f"dbname={os.getenv('POSTGRES_NAME', 'postgres')} "
        f"connect_timeout=15 "
        f"application_name=acme-project-tracker "
        f"options='{options}'"
    )


def get_conn() -> psycopg.Connection:
    """Return a live, cached psycopg connection (reconnects on failure).

    ``autocommit=True`` is the safe default for Lambda: read-only handlers
    don't accidentally leave an implicit transaction open on the cached
    connection between warm invocations. Mutations should still wrap their
    work in :func:`transaction` so the matching ``INSERT INTO audit_log``
    commits atomically.
    """
    global _CONN
    if _CONN is None or _CONN.closed:
        _CONN = psycopg.connect(_conninfo(), row_factory=dict_row, autocommit=True)
    return _CONN


def reset_conn() -> None:
    """Force the next ``get_conn()`` call to open a fresh connection."""
    global _CONN
    try:
        if _CONN is not None and not _CONN.closed:
            _CONN.close()
    except Exception:  # noqa: BLE001 - best-effort cleanup
        pass
    _CONN = None


@contextmanager
def transaction() -> Iterator[psycopg.Connection]:
    """Yield the cached connection inside ``BEGIN/COMMIT``; ``ROLLBACK`` on error.

    Use this around any multi-statement mutation, including the matching
    ``INSERT INTO audit_log`` (see SYSTEM_DESIGN §6).
    """
    conn = get_conn()
    try:
        with conn.transaction():
            yield conn
    except Exception:
        # Connection itself may be poisoned (e.g. broken pipe) — drop it.
        _LOG.exception("Transaction failed; resetting connection")
        reset_conn()
        raise


def audit(
    conn: psycopg.Connection,
    user_id: str | None,
    action: str,
    target_type: str | None,
    target_id: str | None,
    payload: dict | None = None,
) -> None:
    """Append a row to ``audit_log`` inside the caller's transaction."""

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO audit_log (user_id, action, target_type, target_id, payload)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            """,
            (user_id, action, target_type, target_id, json.dumps(payload or {})),
        )


def health() -> bool:
    """``SELECT 1`` against the cached connection; resets on failure."""
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return True
    except Exception:  # noqa: BLE001
        _LOG.exception("DB health check failed")
        reset_conn()
        return False

