/** Shared TypeScript shapes mirroring SYSTEM_DESIGN §6 tables. */

export type Role = 'admin' | 'team_lead' | 'team_member' | 'viewer';

export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'done' | 'cancelled';

export interface User {
  id: string;
  email: string;
  full_name: string;
  job_title: string;
  is_allocatable: boolean;
  weekly_capacity_hours: number;
  role: Role;
  /**
   * Number of distinct projects the user holds at least one APPROVED
   * allocation on. Computed server-side in resources-service.  Optional
   * because the PATCH endpoint returns the user without these counts —
   * always present on GET (list and single-row).
   */
  active_project_count?: number;
  /**
   * Number of *in-flight* assignments the user currently holds: the
   * per-assignment row has not been completed (`completed_at IS NULL`)
   * AND the parent deliverable is not yet `done`/`cancelled` (a lead
   * marking the deliverable Done releases the assignees from the
   * overwork count even if their personal tick was never set).
   * Computed server-side in resources-service. Optional for the same
   * reason as `active_project_count`.
   */
  active_deliverable_count?: number;
  /**
   * Derived server-side flag: `true` when the user has more than 3 active
   * projects OR more than 5 in-flight deliverable assignments (open and
   * whose deliverable is not yet done/cancelled). Thresholds live in
   * `backend/resources-service/function.py`.
   */
  is_overworked?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  owner_id: string;
  /**
   * Owner + co-lead ids in display order (owner first, co-leads in insertion
   * order). Surfaced by projects-service so the SPA can render multi-lead
   * UIs without a second roundtrip. Older payloads that pre-date the
   * `project_leads` table omit this field; treat missing/empty as
   * "[owner_id]".
   */
  lead_ids?: string[];
  created_at: string;
  updated_at: string;
  /**
   * Computed server-side: true when the project owns at least one outdated
   * deliverable (due_date in the past, not done/cancelled) and the project
   * itself isn't done/cancelled. See backend/projects-service `_AT_RISK_SQL`.
   */
  is_at_risk?: boolean;
}

export type DeliverableStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface Deliverable {
  id: string;
  project_id: string;
  title: string;
  status: DeliverableStatus;
  due_date: string | null;
  depends_on: string | null;
  /**
   * Computed server-side: true when `due_date` has passed and `status` is
   * neither `done` nor `cancelled`. See backend/deliverables-service
   * `_OUTDATED_SQL`.
   */
  is_outdated?: boolean;
}

export type AssignmentRole = 'owner' | 'contributor' | 'reviewer';

export interface Assignment {
  id: string;
  deliverable_id: string;
  user_id: string;
  role_on_assignment: AssignmentRole;
  percent: number;
  assigned_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

export interface Allocation {
  id: string;
  user_id: string;
  project_id: string;
  /**
   * Legacy capacity percentage. Migration 003 made the column nullable;
   * new SPA flows omit it and use `role_description` instead. Historical
   * rows still carry a value, which is why this is `number | null`.
   */
  percent: number | null;
  /** Free-text description of the role the user plays on the project. */
  role_description: string;
  start_date: string;
  end_date: string;
  approval_status: ApprovalStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * Live projection of a project's singular budget. Returned by
 * `GET /budget-service?project_id=…` and after `PUT /budget-service`.
 * Earlier versions of the API exposed a list of category-scoped
 * `budget_plans` with append-only `budget_entries`; both have been removed
 * in favour of one ceiling per project, drawn against by `equipment.cost`
 * on tangibles/intangibles assigned to the project.
 */
export interface ProjectBudget {
  project_id: string;
  /** Ceiling. `null` = no budget set, gate is disabled. */
  budget_amount: string | null;
  budget_currency: string;
  /** Sum of equipment.cost for approved + pending charges on the project. */
  amount_consumed: string;
  /** budget_amount - amount_consumed, or `null` when no ceiling. */
  remaining: string | null;
  /** Equipment rows currently committed against the budget. */
  charges: BudgetCharge[];
}

/** One equipment row drawing against the project's budget. */
export interface BudgetCharge {
  id: string;
  name: string;
  kind: string;
  is_tangible: boolean;
  cost: string | null;
  currency: string;
  status: EquipmentStatus;
  approval_status: ApprovalStatus;
}

/**
 * Coarse resource taxonomy surfaced under `/resources`. The project tracks
 * five kinds of resource: people (allocatable users), deliverables (work
 * products), tangibles (physical assets), intangibles (licenses,
 * subscriptions, certifications), and budget (money). Each lives in its
 * own table or column; this enum exists only to label the UI tabs / nav.
 * Tangibles and intangibles share the `equipment` table, distinguished by
 * `is_tangible` (migration 004).
 */
export type ResourceKind = 'people' | 'deliverables' | 'tangibles' | 'intangibles' | 'budget';

/**
 * Equipment kinds are free-form (any tangible asset — laptop, vehicle,
 * software license, conference room, 3d-printer, …). Backed by a plain
 * TEXT column without a CHECK constraint (see migration 003); the UI offers
 * common values via a datalist but does not constrain the input.
 */
export type EquipmentKind = string;
export type EquipmentStatus = 'available' | 'in_use' | 'maintenance' | 'retired';

export interface Equipment {
  id: string;
  name: string;
  kind: EquipmentKind;
  serial_number: string | null;
  status: EquipmentStatus;
  assigned_project_id: string | null;
  assigned_user_id: string | null;
  /**
   * The specific deliverable this asset directly supports (migration 003).
   * `null` means the asset is assigned to the project but not yet tied to a
   * particular deliverable.
   */
  assigned_deliverable_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  approval_status: ApprovalStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** Migration 004: physical asset (true) vs license/subscription (false). */
  is_tangible: boolean;
  /** Optional unit cost. When set together with `assigned_project_id`, the
   *  backend gates the assignment by the project's remaining budget. */
  cost: string | null;
  currency: string;
}


