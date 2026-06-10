-- 002_seed_personas.sql — pre-seed the four canonical workshop personas so
-- the People list and allocations picker are populated before anyone signs in.
--
-- `pending:<email>` is a sentinel for the UNIQUE NOT NULL `cognito_sub`. On
-- first real login `_lib/auth._ensure_user` upserts ON CONFLICT (email),
-- atomically swapping the sentinel for the real Cognito sub.
--
-- Role/allocatability per the v1.4 spec:
--   admin       → is_allocatable=false (operators, not project workers)
--   team_lead   → is_allocatable=true
--   team_member → is_allocatable=true
--   viewer      → is_allocatable=false (executives — observers only)
--
-- Idempotent: ON CONFLICT (email) DO NOTHING skips re-runs.

INSERT INTO users (cognito_sub, email, role, is_allocatable, full_name) VALUES
  ('pending:admin@workshop.local',  'admin@workshop.local',  'admin',       FALSE, 'Workshop Admin'),
  ('pending:lead@workshop.local',   'lead@workshop.local',   'team_lead',   TRUE,  'Workshop Lead'),
  ('pending:member@workshop.local', 'member@workshop.local', 'team_member', TRUE,  'Workshop Member'),
  ('pending:viewer@workshop.local', 'viewer@workshop.local', 'viewer',      FALSE, 'Workshop Viewer')
ON CONFLICT (email) DO NOTHING;

