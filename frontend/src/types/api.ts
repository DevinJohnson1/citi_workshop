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
  created_at: string;
  updated_at: string;
}

export type DeliverableStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface Deliverable {
  id: string;
  project_id: string;
  title: string;
  status: DeliverableStatus;
  due_date: string | null;
  depends_on: string | null;
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
  percent: number;
  start_date: string;
  end_date: string;
  approval_status: ApprovalStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface BudgetPlan {
  id: string;
  project_id: string;
  category: string;
  amount_planned: string;
  amount_consumed?: string;
  currency: string;
  planned_at: string;
}

/**
 * Coarse resource taxonomy surfaced under `/resources`. The project tracks
 * four kinds of resource: people (allocatable users), deliverables (work
 * products), equipment (tangible assets), and budget (money). Each lives in
 * its own table; this enum exists only to label the UI tabs / nav.
 */
export type ResourceKind = 'people' | 'deliverables' | 'equipment' | 'budget';

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
  notes: string;
  created_at: string;
  updated_at: string;
  approval_status: ApprovalStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}


