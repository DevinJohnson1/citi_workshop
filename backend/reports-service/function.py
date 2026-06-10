"""reports-service — read-only rollups for the 7 workshop questions.

Routes (relative to ``/api/reports-service``)::

    GET /at-risk
    GET /over-allocated
    GET /over-assigned
    GET /allocation-by-user           ?user_id=&start=&end=
    GET /deliverable-completion       ?project_id=
    GET /budget-vs-planned
    GET /deliverable-chain            ?project_id=
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from _lib import db, http
from _lib.auth import AuthError, handle_auth_errors, verify_token

_LOG = logging.getLogger()
_LOG.setLevel(logging.INFO)
_SERVICE = "reports-service"


def handler(event: Mapping[str, Any], context: Any = None) -> dict[str, Any]:
    """Lambda entrypoint."""
    if http.is_options(event):
        return http.no_content(event)
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "GET").upper()
    parts = http.path_parts(event, _SERVICE)
    try:
        if method == "GET" and parts == ["health"]:
            return http.ok({"status": "UP", "db": "UP" if db.health() else "DOWN"}, event)
        if method != "GET" or len(parts) != 1:
            return http.not_found(event=event)

        verify_token(event)
        endpoint = parts[0]
        qs = http.query_params(event)
        if endpoint == "at-risk":
            return http.ok(_at_risk(), event)
        if endpoint == "over-allocated":
            return http.ok(_over_allocated(), event)
        if endpoint == "over-assigned":
            return http.ok(_over_assigned(), event)
        if endpoint == "allocation-by-user":
            return http.ok(_allocation_by_user(qs), event)
        if endpoint == "deliverable-completion":
            return http.ok(_deliverable_completion(qs.get("project_id")), event)
        if endpoint == "budget-vs-planned":
            return http.ok(_budget_vs_planned(), event)
        if endpoint == "deliverable-chain":
            pid = qs.get("project_id")
            if not pid:
                raise ValueError("project_id: query parameter is required")
            return http.ok(_deliverable_chain(pid), event)
        return http.not_found(event=event)
    except AuthError as exc:
        return handle_auth_errors(event, exc)
    except ValueError as exc:
        return http.bad_request(str(exc), event)
    except Exception:  # noqa: BLE001
        _LOG.exception("Unhandled error in %s", _SERVICE)
        db.reset_conn()
        return http.error(event=event)


def _rows(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    conn = db.get_conn()
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def _at_risk() -> dict[str, Any]:
    """Projects whose target_end_date < today+14 and status not done/cancelled."""
    data = _rows(
        """
        SELECT id, name, status, target_end_date, owner_id
        FROM projects
        WHERE target_end_date < (CURRENT_DATE + INTERVAL '14 days')
          AND status NOT IN ('done','cancelled')
        ORDER BY target_end_date NULLS LAST
        """
    )
    return {"data": data}


def _over_allocated() -> dict[str, Any]:
    """Users whose summed `allocations.percent` exceeds 100 in any overlapping window.

    Uses self-join: for every allocation A, sum percent of allocations whose
    window overlaps A's. Returns rows where the rolling total > 100.
    """
    data = _rows(
        """
        SELECT u.id AS user_id, u.email, u.full_name,
               MAX(overlap.total_pct) AS peak_pct
        FROM users u
        JOIN allocations a ON a.user_id = u.id
        JOIN LATERAL (
            SELECT SUM(a2.percent) AS total_pct
            FROM allocations a2
            WHERE a2.user_id = a.user_id
              AND a2.start_date <= a.end_date
              AND a2.end_date   >= a.start_date
        ) overlap ON TRUE
        GROUP BY u.id, u.email, u.full_name
        HAVING MAX(overlap.total_pct) > 100
        ORDER BY peak_pct DESC
        """
    )
    return {"data": data}


def _over_assigned() -> dict[str, Any]:
    """Users whose open assignments sum to > 100% (independent of allocations)."""
    data = _rows(
        """
        SELECT u.id AS user_id, u.email, u.full_name,
               SUM(a.percent) AS total_pct,
               COUNT(*) AS open_assignments
        FROM assignments a
        JOIN users u ON u.id = a.user_id
        WHERE a.completed_at IS NULL
        GROUP BY u.id, u.email, u.full_name
        HAVING SUM(a.percent) > 100
        ORDER BY total_pct DESC
        """
    )
    return {"data": data}


def _allocation_by_user(qs: dict[str, str]) -> dict[str, Any]:
    """Rolls up allocations per user, optionally bounded by ``user_id`` / window."""
    where = []
    params: list[Any] = []
    if uid := qs.get("user_id"):
        where.append("a.user_id = %s"); params.append(uid)
    if start := qs.get("start"):
        where.append("a.end_date >= %s"); params.append(start)
    if end := qs.get("end"):
        where.append("a.start_date <= %s"); params.append(end)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    data = _rows(
        f"""
        SELECT u.id AS user_id, u.email, u.full_name,
               COUNT(*) AS allocation_count,
               COALESCE(SUM(a.percent), 0) AS total_pct
        FROM users u
        LEFT JOIN allocations a ON a.user_id = u.id
        {where_sql}
        GROUP BY u.id, u.email, u.full_name
        ORDER BY total_pct DESC, u.email
        """,
        tuple(params),
    )
    return {"data": data}


def _deliverable_completion(project_id: str | None) -> dict[str, Any]:
    """Percent of deliverables whose every assignment is completed."""
    if not project_id:
        raise ValueError("project_id: query parameter is required")
    rows = _rows(
        """
        WITH d AS (
            SELECT id FROM deliverables WHERE project_id = %s
        ),
        completion AS (
            SELECT d.id,
                   CASE
                     WHEN NOT EXISTS (SELECT 1 FROM assignments a WHERE a.deliverable_id = d.id) THEN FALSE
                     WHEN EXISTS (SELECT 1 FROM assignments a
                                  WHERE a.deliverable_id = d.id AND a.completed_at IS NULL) THEN FALSE
                     ELSE TRUE
                   END AS is_complete
            FROM d
        )
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN is_complete THEN 1 ELSE 0 END) AS completed
        FROM completion
        """,
        (project_id,),
    )
    total = rows[0]["total"] or 0
    completed = rows[0]["completed"] or 0
    pct = (float(completed) / total * 100.0) if total else 0.0
    return {"data": {"project_id": project_id, "total": total,
                     "completed": completed, "percent_complete": round(pct, 2)}}


def _budget_vs_planned() -> dict[str, Any]:
    """Per-project planned vs consumed totals."""
    data = _rows(
        """
        SELECT p.id AS project_id, p.name,
               COALESCE(SUM(bp.amount_planned), 0)::numeric(14,2) AS planned,
               COALESCE((
                   SELECT SUM(be.amount)
                   FROM budget_entries be
                   JOIN budget_plans bp2 ON bp2.id = be.budget_plan_id
                   WHERE bp2.project_id = p.id
               ), 0)::numeric(14,2) AS consumed
        FROM projects p
        LEFT JOIN budget_plans bp ON bp.project_id = p.id
        GROUP BY p.id, p.name
        ORDER BY p.name
        """
    )
    return {"data": data}


def _deliverable_chain(project_id: str) -> dict[str, Any]:
    """Recursive dependency chain for a project's deliverables."""
    data = _rows(
        """
        WITH RECURSIVE chain AS (
            SELECT id, title, depends_on, 0 AS depth, ARRAY[id] AS path
            FROM deliverables
            WHERE project_id = %s AND depends_on IS NULL
            UNION ALL
            SELECT d.id, d.title, d.depends_on, c.depth + 1, c.path || d.id
            FROM deliverables d
            JOIN chain c ON d.depends_on = c.id
            WHERE NOT d.id = ANY(c.path)  -- guard against cycles
        )
        SELECT id, title, depends_on, depth FROM chain ORDER BY depth, title
        """,
        (project_id,),
    )
    return {"data": data}

