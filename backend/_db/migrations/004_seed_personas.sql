-- 004_seed_personas.sql
--
-- Pre-seed the four canonical workshop personas into the ``users`` table so
-- the People resource list and the project allocations picker are populated
-- IMMEDIATELY, before anyone has logged in. Without this, brand-new
-- environments show an empty "pick a member" dropdown on /projects/:id
-- because Cognito users only acquire a DB row on first login — chicken-and-
-- egg.
--
-- We use a ``pending:<email>`` sentinel for ``cognito_sub`` (UNIQUE NOT NULL
-- in the schema). On first real login, ``_lib/auth._ensure_user`` upserts
-- ON CONFLICT (email), which atomically swaps the sentinel for the real
-- Cognito sub.
--
-- Role-allocatability follows the v1.4 spec:
--   - admin       → is_allocatable=false (admins don't work on projects)
--   - team_lead   → is_allocatable=true  (can lead + be staffed)
--   - team_member → is_allocatable=true
--   - viewer      → is_allocatable=false (executives — observers only)
--
-- Idempotent: ON CONFLICT (email) DO NOTHING skips re-runs.

INSERT INTO users (cognito_sub, email, role, is_allocatable, full_name) VALUES
  ('pending:admin@workshop.local',  'admin@workshop.local',  'admin',       FALSE, 'Workshop Admin'),
  ('pending:lead@workshop.local',   'lead@workshop.local',   'team_lead',   TRUE,  'Workshop Lead'),
  ('pending:member@workshop.local', 'member@workshop.local', 'team_member', TRUE,  'Workshop Member'),
  ('pending:viewer@workshop.local', 'viewer@workshop.local', 'viewer',      FALSE, 'Workshop Viewer')
ON CONFLICT (email) DO NOTHING;

-- v1.4 spec: admins are operators, not project workers. Undo the v1.3
-- backfill that flagged them allocatable.
UPDATE users SET is_allocatable = FALSE
 WHERE role = 'admin' AND is_allocatable = TRUE;

