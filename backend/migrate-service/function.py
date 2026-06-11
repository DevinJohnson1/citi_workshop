"""migrate-service — apply every bundled SQL migration to Aurora from inside the VPC.
This service exists because the Aurora cluster lives in a private VPC subnet
and is unreachable from participant laptops / VDIs that don't have a route
into the VPC. Running migrations from inside a Lambda removes the host-side
network requirement entirely — the Lambda is attached to the same security
group + subnets as the cluster and talks to Aurora over the VPC backbone.
## Invocation
**Direct ``aws lambda invoke`` only.** IAM authorises the caller; no HTTP
surface, no shared secret. The Function URL that the shared lambda module
creates for every service is ignored — any non-empty event payload is fine
(``{}`` is canonical) and the handler does not inspect it. The wrapper
``bin/migrate.sh`` is the supported entry point and is invoked
automatically at the end of ``bin/deploy-backend.sh`` for both local (LocalStack) and aws targets.
## Bundling the SQL
Every file in ``backend/_db/migrations/*.sql`` is rsynced into
``backend/migrate-service/_migrations/`` by ``bin/deploy-backend.sh`` right
before ``terraform apply``, so the SQL ships inside the deployment package.
At runtime the handler scans ``_migrations/*.sql`` in lexical order and
sends each file as a single simple-query batch to Postgres, executing all
statements in the file (including ``DO $$ … $$`` blocks) as one unit.
## Idempotency
The migration files use ``CREATE … IF NOT EXISTS``, ``CREATE OR REPLACE``,
``ON CONFLICT DO NOTHING``, etc., so re-invoking this Lambda is safe.
Each file runs in its own transaction; a failure rolls back that file and
aborts subsequent files, so partial schema states are impossible.
"""
from __future__ import annotations
import logging
import os
import time
from pathlib import Path
from typing import Any, Mapping
import psycopg
_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)
# Migrations are bundled into the deployment package by bin/deploy-backend.sh
# (rsync _db/migrations -> backend/migrate-service/_migrations). At runtime
# the Lambda root is the package root, so the directory lives next to this
# file regardless of cwd.
_MIGRATIONS_DIR = Path(__file__).resolve().parent / "_migrations"
def handler(event: Mapping[str, Any], context: Any = None) -> dict[str, Any]:
    """Apply every bundled ``_migrations/*.sql`` in lexical order.
    Returns ``{"ok": true, "applied": [...], "total_files": N}`` on success
    or ``{"ok": false, "error": "...", "applied": [...]}`` if a file fails.
    The event payload is intentionally ignored — this Lambda has exactly
    one job and no parameters.
    """
    try:
        return {"ok": True, **_apply_migrations()}
    except Exception as exc:  # noqa: BLE001 — last-ditch reporting layer
        _LOG.exception("Migration run failed")
        return {"ok": False, "error": str(exc)}
def _apply_migrations() -> dict[str, Any]:
    """Apply every ``_migrations/*.sql`` in lex order; return a per-file summary."""
    if not _MIGRATIONS_DIR.is_dir():
        raise RuntimeError(
            f"Migrations directory missing from deployment package: {_MIGRATIONS_DIR}. "
            "Re-run bin/deploy-backend.sh — its rsync step should populate it."
        )
    files = sorted(p for p in _MIGRATIONS_DIR.glob("*.sql") if p.is_file())
    if not files:
        raise RuntimeError(
            f"No .sql files found under {_MIGRATIONS_DIR}. Check that "
            "bin/deploy-backend.sh copied backend/_db/migrations/ in."
        )
    applied: list[dict[str, Any]] = []
    # Fresh connection per invocation: schema-change sessions should never
    # reuse a cached socket that might have been left in a quirky state by
    # a previous warm invocation. One transaction per file so a failure
    # rolls back that file cleanly without leaving the schema half-applied.
    conn = psycopg.connect(_conninfo(), autocommit=False)
    try:
        for path in files:
            sql_text = path.read_text(encoding="utf-8")
            t0 = time.monotonic()
            try:
                with conn.cursor() as cur:
                    cur.execute(sql_text)
                conn.commit()
                applied.append({
                    "file": path.name,
                    "bytes": len(sql_text.encode("utf-8")),
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                    "status": "ok",
                })
                _LOG.info("Applied %s (%d bytes) in %d ms",
                          path.name, len(sql_text), applied[-1]["duration_ms"])
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                applied.append({
                    "file": path.name,
                    "status": "failed",
                    "error": str(exc),
                })
                _LOG.exception("Migration %s failed; aborting run", path.name)
                raise
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001  # nosec B110 — best-effort cleanup
            pass
    return {"applied": applied, "total_files": len(files)}
def _conninfo() -> str:
    """libpq conninfo built from the same env vars every other service uses."""
    return (
        f"host={os.getenv('POSTGRES_HOST', 'localhost')} "
        f"port={os.getenv('POSTGRES_PORT', '5432')} "
        f"user={os.getenv('POSTGRES_USER', 'postgres')} "
        f"password={os.getenv('POSTGRES_PASS', 'postgres123')} "
        f"dbname={os.getenv('POSTGRES_NAME', 'postgres')} "
        f"connect_timeout=15 "
        f"application_name=acme-migrate-service "
    )
