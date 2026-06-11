"""Shared project-authorisation helpers.

A *project lead* is either:

* the canonical owner stored on ``projects.owner_id``, or
* any user listed in the ``project_leads`` join table (co-leads).

Every dependent service (allocations, deliverables, equipment, budget,
assignments, projects) routes its "is this caller allowed to write on
this project?" check through :func:`is_project_lead` so a single SQL
source-of-truth governs co-lead semantics. The ``team_lead`` role check
itself stays at the call site — this helper only resolves *membership*,
not RBAC class.
"""

from __future__ import annotations

from typing import Any


def is_project_lead(conn: Any, project_id: str, user_id: str) -> bool:
    """Return ``True`` when ``user_id`` owns or co-leads ``project_id``.

    Cheap: a single round-trip with two index-backed lookups unioned.
    Returns ``False`` for missing projects too — callers that need a
    distinction should fetch the project row separately.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM projects
              WHERE id = %s AND owner_id = %s
            UNION ALL
            SELECT 1 FROM project_leads
              WHERE project_id = %s AND user_id = %s
            LIMIT 1
            """,
            (project_id, user_id, project_id, user_id),
        )
        return cur.fetchone() is not None


def project_lead_ids(conn: Any, project_id: str) -> list[str]:
    """Return the full set of lead ids for a project (owner + co-leads).

    Order: owner first, then co-leads in insertion order. The owner is
    always present (NOT NULL FK). Used to embed ``lead_ids`` in API
    responses so the SPA can render "manage co-leads" UIs without
    chasing a second endpoint.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT owner_id AS uid, 0 AS ord, NULL::timestamptz AS added_at
              FROM projects WHERE id = %s
            UNION ALL
            SELECT user_id AS uid, 1 AS ord, added_at
              FROM project_leads WHERE project_id = %s
            ORDER BY ord, added_at NULLS FIRST
            """,
            (project_id, project_id),
        )
        return [row["uid"] for row in cur.fetchall()]

