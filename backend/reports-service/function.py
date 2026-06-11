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
_SERVICE = "reports-service"

# Workload thresholds for the over-assigned ("overworked") report. Kept in
# lock-step with the same constants in resources-service so the per-user
# `is_overworked` flag and this org-wide rollup never disagree. A user is
# over-assigned when EITHER threshold is exceeded.
_OVERWORK_PROJECT_THRESHOLD = 3
_OVERWORK_DELIVERABLE_THRESHOLD = 5


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
    """Projects flagged "at risk" because they own at least one outdated deliverable.

    A deliverable is outdated when its ``due_date`` has passed and it isn't
    ``done`` / ``cancelled``. A project is at risk when it owns any such
    deliverable AND it is still in flight — status is ``planned``, ``active``
    or ``on_hold``. Projects that are ``done`` or ``cancelled`` are never
    at-risk, regardless of dangling deliverables.
    The response includes ``outdated_count`` so the dashboard can show
    severity at a glance.
    """
    data = _rows(
        """
        SELECT p.id, p.name, p.status, p.target_end_date, p.owner_id,
               COUNT(d.id) AS outdated_count
        FROM projects p
        JOIN deliverables d ON d.project_id = p.id
        WHERE p.status IN ('planned','active','on_hold')
          AND d.due_date IS NOT NULL
          AND d.due_date < CURRENT_DATE
          AND d.status NOT IN ('done','cancelled')
        GROUP BY p.id, p.name, p.status, p.target_end_date, p.owner_id
        ORDER BY outdated_count DESC, p.target_end_date NULLS LAST
        """
    )
    return {"data": data}


def _over_allocated() -> dict[str, Any]:
    """Users with more than one *approved* allocation whose date windows overlap.

    Migration 005 dropped ``allocations.percent``, so capacity is no longer
    tracked numerically. This report now answers the structural question
    "is anyone double-booked at all?" — for every approved allocation A we
    count approved allocations on the same user whose window overlaps A's,
    and surface users where that peak overlap count exceeds 1.
    """
    data = _rows(
        """
        SELECT u.id AS user_id, u.email, u.full_name,
               MAX(overlap.overlap_count) AS peak_overlap
        FROM users u
        JOIN allocations a ON a.user_id = u.id AND a.approval_status = 'approved'
        JOIN LATERAL (
            SELECT COUNT(*) AS overlap_count
            FROM allocations a2
            WHERE a2.user_id = a.user_id
              AND a2.approval_status = 'approved'
              AND a2.start_date <= a.end_date
              AND a2.end_date   >= a.start_date
        ) overlap ON TRUE
        GROUP BY u.id, u.email, u.full_name
        HAVING MAX(overlap.overlap_count) > 1
        ORDER BY peak_overlap DESC
        """
    )
    return {"data": data}


def _over_assigned() -> dict[str, Any]:
    """Users who are *over-assigned* by the workload-thresholds rule.

    A user is over-assigned when EITHER

      * the number of distinct projects they hold at least one approved
        allocation on exceeds ``_OVERWORK_PROJECT_THRESHOLD`` (default 3), OR
      * the number of *in-flight* assignments they hold across every
        deliverable exceeds ``_OVERWORK_DELIVERABLE_THRESHOLD`` (default 5).
        "In-flight" means the per-assignment row has not been completed
        (``completed_at IS NULL``) AND the parent deliverable is not
        already ``done`` or ``cancelled`` — once a lead marks the
        deliverable Done, it stops counting against the assignee's
        workload even if the per-assignment tick was never set.

    This rule replaces the legacy ``SUM(assignments.percent) > 100`` check
    which became meaningless after migration 005 dropped a uniform notion of
    "100% capacity" from allocations. The same thresholds are computed
    per-user in resources-service as ``is_overworked`` so pickers and
    rosters can show the warning inline; this endpoint is the org-wide
    rollup that powers the Reports page.
    """
    data = _rows(
        f"""
        WITH workload AS (
            SELECT
                u.id    AS user_id,
                u.email,
                u.full_name,
                COALESCE((
                    SELECT COUNT(DISTINCT project_id)
                    FROM allocations
                    WHERE user_id = u.id AND approval_status = 'approved'
                ), 0) AS active_project_count,
                COALESCE((
                    SELECT COUNT(*)
                    FROM assignments asg
                    JOIN deliverables d ON d.id = asg.deliverable_id
                    WHERE asg.user_id = u.id
                      AND asg.completed_at IS NULL
                      AND d.status NOT IN ('done','cancelled')
                ), 0) AS active_deliverable_count
            FROM users u
            WHERE u.role IN ('team_lead','team_member')
        )
        SELECT
            user_id,
            email,
            full_name,
            active_project_count,
            active_deliverable_count,
            (active_project_count     > {_OVERWORK_PROJECT_THRESHOLD})     AS exceeds_project_threshold,
            (active_deliverable_count > {_OVERWORK_DELIVERABLE_THRESHOLD}) AS exceeds_deliverable_threshold
        FROM workload
        WHERE active_project_count     > {_OVERWORK_PROJECT_THRESHOLD}
           OR active_deliverable_count > {_OVERWORK_DELIVERABLE_THRESHOLD}
        ORDER BY active_deliverable_count DESC, active_project_count DESC
        """
    )
    return {
        "data": data,
        "meta": {
            "project_threshold":     _OVERWORK_PROJECT_THRESHOLD,
            "deliverable_threshold": _OVERWORK_DELIVERABLE_THRESHOLD,
        },
    }


def _allocation_by_user(qs: dict[str, str]) -> dict[str, Any]:
    """Rolls up allocations per user, optionally bounded by ``user_id`` / window.

    Capacity used to be reported as ``SUM(percent)``; migration 005 dropped
    that column, so this now returns just the allocation count per user.
    """
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
               COUNT(a.id) AS allocation_count
        FROM users u
        LEFT JOIN allocations a ON a.user_id = u.id
        {where_sql}
        GROUP BY u.id, u.email, u.full_name
        ORDER BY allocation_count DESC, u.email
        """,
        tuple(params),
    )
    return {"data": data}


def _deliverable_completion(project_id: str | None) -> dict[str, Any]:
    """Percent of a project's deliverables that have reached ``status='done'``.

    A deliverable is "complete" iff its own ``status`` column is ``done`` —
    the same signal the StatusBadge shows everywhere else in the UI. The
    earlier rule keyed off ``assignments.completed_at`` and therefore
    disagreed with the deliverable's visible status (e.g. a row marked
    "done" by the team-lead but with no per-assignment completion ticks
    counted as 0%, while a row with no assignments at all looked the same).

    ``cancelled`` deliverables are excluded from the denominator: they
    were de-scoped and dragging them into the percentage would penalise
    the project for *not* doing work that was deliberately dropped.
    """
    if not project_id:
        raise ValueError("project_id: query parameter is required")
    rows = _rows(
        """
        SELECT
            COUNT(*) FILTER (WHERE status <> 'cancelled')               AS total,
            COUNT(*) FILTER (WHERE status = 'done')                     AS completed
        FROM deliverables
        WHERE project_id = %s
        """,
        (project_id,),
    )
    total = rows[0]["total"] or 0
    completed = rows[0]["completed"] or 0
    pct = (float(completed) / total * 100.0) if total else 0.0
    return {"data": {"project_id": project_id, "total": total,
                     "completed": completed, "percent_complete": round(pct, 2)}}


def _budget_vs_planned() -> dict[str, Any]:
    """Per-project planned vs consumed totals.

    ``planned`` is the project's singular ``budget_amount`` (NULL when no
    ceiling has been set — surfaced as 0 so the column still sorts). The
    ``consumed`` figure is the sum of ``equipment.cost`` for every approved
    or pending tangible/intangible assigned to the project — the only thing
    that draws against the budget in this data model.
    """
    data = _rows(
        """
        SELECT p.id AS project_id, p.name,
               COALESCE(p.budget_amount, 0)::numeric(14,2) AS planned,
               COALESCE((
                   SELECT SUM(e.cost)
                   FROM equipment e
                   WHERE e.assigned_project_id = p.id
                     AND e.cost IS NOT NULL
                     AND e.approval_status IN ('approved', 'pending')
               ), 0)::numeric(14,2) AS consumed,
               p.budget_currency AS currency
        FROM projects p
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

