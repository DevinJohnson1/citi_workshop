-- 002_resources_taxonomy.sql — separate "resources" into distinct types.
--
-- Background: SYSTEM_DESIGN §5 used "resources" loosely to mean
-- `users WHERE is_allocatable=true`. Real PM workflows track several kinds
-- of resource (people, deliverables, equipment, budget) and the UI now
-- surfaces them as distinct tabs under /resources. This migration adds the
-- missing third type — equipment — alongside the existing
-- people/deliverables/budget entities. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  -- Coarse taxonomy. Add values via a new migration; never widen via app code.
  kind TEXT NOT NULL
    CHECK (kind IN ('laptop','vehicle','license','room','other')),
  serial_number TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','in_use','maintenance','retired')),
  -- Optional check-out targets. Either, both, or neither may be set.
  assigned_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  assigned_user_id    UUID REFERENCES users(id)    ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_kind     ON equipment(kind);
CREATE INDEX IF NOT EXISTS idx_equipment_status   ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_project  ON equipment(assigned_project_id);
CREATE INDEX IF NOT EXISTS idx_equipment_user     ON equipment(assigned_user_id);

CREATE OR REPLACE TRIGGER set_equipment_updated_at BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

