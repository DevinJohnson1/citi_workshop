-- 001_init.sql — ACME Project Tracker baseline schema.
-- See SYSTEM_DESIGN.md §6 for rationale. Idempotent; safe to re-run.
--
-- This file is the *consolidated* baseline. Earlier incremental migrations
-- (003 role_description, 004 equipment tangible/cost/currency, 005 drop
-- allocations.percent, 006 collapse budget_plans/budget_entries into a
-- singular projects.budget_amount) have been folded directly into the
-- CREATE TABLE statements below — the database is recreated from scratch
-- on every dev environment, so there is no value in keeping the historical
-- ALTER chain. 002_seed_personas.sql is intentionally kept separate so
-- seed data can be re-applied or edited without touching the schema.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE OR REPLACE FUNCTION trigger_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Single identity table. `is_allocatable` flags users who can be staffed.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  is_allocatable BOOLEAN NOT NULL DEFAULT FALSE,
  weekly_capacity_hours SMALLINT NOT NULL DEFAULT 40 CHECK (weekly_capacity_hours BETWEEN 0 AND 80),
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin','team_lead','team_member','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_allocatable ON users(is_allocatable) WHERE is_allocatable;
CREATE OR REPLACE TRIGGER set_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','on_hold','done','cancelled')),
  start_date DATE,
  target_end_date DATE,
  actual_end_date DATE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Singular budget per project. NULL = "no budget set" → equipment-service
  -- skips the budget gate. Non-NULL → all approved+pending equipment rows
  -- assigned to this project must sum (in equipment.cost) to ≤ budget_amount.
  -- We deliberately do NOT use a separate budget_plans/budget_entries table:
  -- the project has *one* total cost ceiling, and tangibles/intangibles are
  -- the only line items that draw against it.
  budget_amount NUMERIC(14,2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  budget_currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_owner      ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status     ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_target_end ON projects(target_end_date);
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm  ON projects USING gin (LOWER(name) gin_trgm_ops);
CREATE OR REPLACE TRIGGER set_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
  due_date DATE,
  depends_on UUID REFERENCES deliverables(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deliverables_project    ON deliverables(project_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_status     ON deliverables(status);
CREATE INDEX IF NOT EXISTS idx_deliverables_due        ON deliverables(due_date);
CREATE INDEX IF NOT EXISTS idx_deliverables_title_trgm ON deliverables USING gin (LOWER(title) gin_trgm_ops);
CREATE OR REPLACE TRIGGER set_deliverables_updated_at BEFORE UPDATE ON deliverables
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  role_on_assignment TEXT NOT NULL
    CHECK (role_on_assignment IN ('owner','contributor','reviewer')),
  percent SMALLINT NOT NULL DEFAULT 100 CHECK (percent BETWEEN 1 AND 100),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (deliverable_id, user_id, role_on_assignment)
);
CREATE INDEX IF NOT EXISTS idx_assignments_deliverable ON assignments(deliverable_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user_open   ON assignments(user_id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assignments_user_role   ON assignments(user_id, role_on_assignment);

-- Project-level capacity allocation (independent of deliverable-level assignments).
-- Capacity is described in free text (`role_description`) — there is no
-- numeric percent column. The reports-service derives overlap purely from
-- the [start_date, end_date] window + approval_status.
-- Approval workflow: team_member self-requests → 'pending'; admin/lead writes → 'approved'.
CREATE TABLE IF NOT EXISTS allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_description TEXT NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_allocations_user     ON allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_allocations_project  ON allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_allocations_range    ON allocations(user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_allocations_approval ON allocations(approval_status);

-- Free-form `kind` taxonomy — UI offers autocomplete via /equipment-service/kinds.
-- `is_tangible` splits physical assets (laptops, vehicles, …) from intangibles
-- (licenses, subscriptions, certifications). `cost`/`currency` let the
-- equipment-service gate project assignments by remaining project budget;
-- NULL cost means "no recorded cost" and bypasses the gate.
-- `assigned_deliverable_id` (optional) narrows a project-level assignment
-- down to the specific deliverable the asset supports. Many equipment rows
-- can point at one deliverable. ON DELETE SET NULL: removing a deliverable
-- frees its assets back to the project pool rather than deleting them.
CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  serial_number TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','in_use','maintenance','retired')),
  assigned_project_id     UUID REFERENCES projects(id)     ON DELETE SET NULL,
  assigned_user_id        UUID REFERENCES users(id)        ON DELETE SET NULL,
  assigned_deliverable_id UUID REFERENCES deliverables(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ,
  is_tangible BOOLEAN NOT NULL DEFAULT TRUE,
  cost NUMERIC(12,2) CHECK (cost IS NULL OR cost >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipment_kind        ON equipment(kind);
CREATE INDEX IF NOT EXISTS idx_equipment_status      ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_project     ON equipment(assigned_project_id);
CREATE INDEX IF NOT EXISTS idx_equipment_user        ON equipment(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_deliverable ON equipment(assigned_deliverable_id)
  WHERE assigned_deliverable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_approval    ON equipment(approval_status);
CREATE INDEX IF NOT EXISTS idx_equipment_is_tangible ON equipment(is_tangible);
CREATE OR REPLACE TRIGGER set_equipment_updated_at BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Budget storage: collapsed into projects.budget_amount above. The previous
-- budget_plans / budget_entries pair has been removed — the project carries
-- a single budget ceiling, and equipment.cost on assigned tangibles /
-- intangibles is the only thing that draws against it. Audit log follows.

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);








