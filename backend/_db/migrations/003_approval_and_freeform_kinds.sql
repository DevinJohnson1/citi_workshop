-- 003_approval_and_freeform_kinds.sql
--
-- Three changes:
--   1. Drop the equipment.kind CHECK constraint so any tangible-asset
--      taxonomy is supported (no more hard-coded list).
--   2. Add a generic approval workflow (pending/approved/rejected) to
--      `allocations` and `equipment` so team_members can request resources
--      and team_leads can approve. Backward compatible: existing rows
--      default to 'approved', and team_lead/admin writes stay
--      auto-approved going forward.
--   3. Backfill `is_allocatable` for every seeded role that should appear
--      in staffing pickers — admins, team leads, team members. Previously
--      every row defaulted to false, which is why /projects/:id pickers
--      were empty.
--
-- Idempotent; safe to re-run.

-- ── 1. equipment.kind goes free-form ────────────────────────────────────
-- The constraint name follows PostgreSQL's auto-naming convention
-- (<table>_<column>_check); DROP IF EXISTS keeps re-runs safe.
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_kind_check;

-- ── 2. Approval workflow columns ────────────────────────────────────────
ALTER TABLE allocations
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_allocations_approval ON allocations(approval_status);
CREATE INDEX IF NOT EXISTS idx_equipment_approval   ON equipment(approval_status);

-- ── 3. Backfill is_allocatable for staff-bearing roles ──────────────────
-- Every admin, team_lead, and team_member should appear in the People
-- resource and in the allocations picker.
UPDATE users
   SET is_allocatable = TRUE
 WHERE role IN ('admin','team_lead','team_member')
   AND is_allocatable = FALSE;

