-- 001_init.sql — ACME Project Tracker baseline schema
-- See SYSTEM_DESIGN.md §6 for rationale. Re-running this file is a no-op.

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
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_target_end ON projects(target_end_date);
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm ON projects USING gin (LOWER(name) gin_trgm_ops);
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
CREATE INDEX IF NOT EXISTS idx_deliverables_project ON deliverables(project_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_status ON deliverables(status);
CREATE INDEX IF NOT EXISTS idx_deliverables_due ON deliverables(due_date);
CREATE INDEX IF NOT EXISTS idx_deliverables_title_trgm ON deliverables USING gin (LOWER(title) gin_trgm_ops);
CREATE OR REPLACE TRIGGER set_deliverables_updated_at BEFORE UPDATE ON deliverables
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  percent SMALLINT NOT NULL CHECK (percent BETWEEN 1 AND 100),
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_allocations_user    ON allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_allocations_project ON allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_allocations_range   ON allocations(user_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS budget_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  amount_planned NUMERIC(14,2) NOT NULL CHECK (amount_planned >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  planned_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, category)
);
CREATE INDEX IF NOT EXISTS idx_budget_plans_project ON budget_plans(project_id);

CREATE TABLE IF NOT EXISTS budget_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_plan_id UUID NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  description TEXT NOT NULL DEFAULT '',
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budget_entries_plan ON budget_entries(budget_plan_id);
CREATE INDEX IF NOT EXISTS idx_budget_entries_recorded ON budget_entries(recorded_at DESC);

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

