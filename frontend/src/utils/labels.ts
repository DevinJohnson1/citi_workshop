/**
 * Display-label helpers.
 *
 * Every status / role / kind value the backend speaks is `snake_case` and
 * lowercase — that's the wire contract and we never mutate it before
 * sending it back. These helpers are for the *rendered* string only: they
 * turn `in_progress` into "In progress", `team_lead` into "Team lead",
 * etc. Sentence case (only the first letter capitalised) is the default
 * because it reads more calmly than Title Case in dense PM surfaces.
 *
 * Use:
 *   - `prettyLabel(value)`      → general default for status/kind/approval
 *   - `roleLabel(role)`         → explicit map for the four user roles
 *   - `approvalLabel(status)`   → explicit map for approval_status values
 *   - `equipmentStatusLabel(s)` → explicit map for equipment lifecycle
 */

import type { ApprovalStatus, EquipmentStatus, Role } from '../types/api';

/**
 * Convert any `snake_case` / `kebab-case` token into a sentence-cased
 * display string. Unknown / already-pretty inputs are returned as-is.
 *
 *   prettyLabel('in_progress')   === 'In progress'
 *   prettyLabel('on_hold')       === 'On hold'
 *   prettyLabel('team_lead')     === 'Team lead'
 *   prettyLabel('')              === ''
 */
export function prettyLabel(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value).trim();
  if (!str) return '';
  const spaced = str.replace(/[_-]+/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ---- explicit overrides where a literal map reads better than a transform ---- */

const ROLE_LABELS: Record<Role, string> = {
  admin:       'Admin',
  team_lead:   'Team lead',
  team_member: 'Team member',
  viewer:      'Viewer',
};

const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending:  'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  available:   'Available',
  in_use:      'In use',
  maintenance: 'Maintenance',
  retired:     'Retired',
};

export function roleLabel(role: Role | string | null | undefined): string {
  if (!role) return '';
  return ROLE_LABELS[role as Role] ?? prettyLabel(role);
}

export function approvalLabel(status: ApprovalStatus | string | null | undefined): string {
  if (!status) return '';
  return APPROVAL_LABELS[status as ApprovalStatus] ?? prettyLabel(status);
}

export function equipmentStatusLabel(status: EquipmentStatus | string | null | undefined): string {
  if (!status) return '';
  return EQUIPMENT_STATUS_LABELS[status as EquipmentStatus] ?? prettyLabel(status);
}

