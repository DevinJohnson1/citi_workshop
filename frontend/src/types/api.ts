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
}

export interface BudgetPlan {
  id: string;
  project_id: string;
  category: string;
  amount_planned: string;
  amount_consumed?: string;
  currency: string;
  planned_at: string;
}

