-- 003_seed_acme_projects.sql — ACME international banking portfolio seed.
--
-- Backfills the 40 @acme.org roster (10 team_lead + 30 team_member) with
-- real `full_name` / `job_title`, then materialises five flagship projects
-- with deliverables, assignments, project-level allocations, and the
-- tangible / intangible equipment each project draws against its budget.
--
-- Deliverable status mix is deliberately varied: ~52% `done`, with a real
-- spread across `in_progress`, `blocked`, `cancelled`, and a few `todo`,
-- so reports / dashboards exercise every status bucket out of the box.
-- Re-running this migration also UPDATEs status / due_date on existing
-- deliverable rows so edits here propagate (no manual reset required).
--
-- Invariants (per workshop spec + platform rules):
--   * Project owners are ALWAYS team_lead. No team_member ever owns a project.
--   * Deliverable assignments are ALWAYS team_member. Leads steer the
--     project; members do the deliverable work. Any of the three assignment
--     roles ('owner' / 'contributor' / 'reviewer') is permitted for a
--     team_member — owning your own deliverable is the normal case.
--   * Allocations follow the assignment pattern: members are allocated to
--     the projects they staff, with date windows inside the project window.
--     The assignments-service capacity gate refuses to assign anyone who
--     does not hold an approved allocation on the deliverable's project,
--     so every (user, deliverable) pair below is matched by a corresponding
--     (user, project) allocation further down in the same block.
--
-- Idempotent: re-running upserts users, and uses NOT EXISTS / ON CONFLICT
-- guards on every other insert so the migration is safe to re-apply.
--
-- Sentinel cognito_sub format mirrors 002_seed_personas.sql:
-- `pending:<email>` is swapped for the real Cognito `sub` on first login
-- by backend/_lib/auth._ensure_user (ON CONFLICT (email) DO UPDATE).

-- ---------------------------------------------------------------------------
-- 1) ACME roster — 10 team leads + 30 team members.
-- ---------------------------------------------------------------------------
-- We upsert full_name / job_title every run so edits here are authoritative
-- and never get clobbered by a stale row left over from a previous run.
INSERT INTO users (cognito_sub, email, role, is_allocatable, full_name, job_title) VALUES
  -- Team leads (10) — each will own exactly one of the five flagship projects
  -- (five owning, five running steering / capacity-planning duties).
  ('pending:olivia.bennett@acme.org',   'olivia.bennett@acme.org',   'team_lead', TRUE, 'Olivia Bennett',   'Director, Payments Platform'),
  ('pending:marcus.chen@acme.org',      'marcus.chen@acme.org',      'team_lead', TRUE, 'Marcus Chen',      'Head of FX & Treasury Engineering'),
  ('pending:priya.raman@acme.org',      'priya.raman@acme.org',      'team_lead', TRUE, 'Priya Raman',      'Director, Mobile Banking'),
  ('pending:jonas.weber@acme.org',      'jonas.weber@acme.org',      'team_lead', TRUE, 'Jonas Weber',      'Lead, Open Banking & PSD2 Compliance'),
  ('pending:amelia.foster@acme.org',    'amelia.foster@acme.org',    'team_lead', TRUE, 'Amelia Foster',    'Lead, Fraud & Financial Crime'),
  ('pending:diego.alvarez@acme.org',    'diego.alvarez@acme.org',    'team_lead', TRUE, 'Diego Alvarez',    'Engineering Manager, Core Banking'),
  ('pending:sasha.petrova@acme.org',    'sasha.petrova@acme.org',    'team_lead', TRUE, 'Sasha Petrova',    'Engineering Manager, Cards & Issuing'),
  ('pending:ravi.subramanian@acme.org', 'ravi.subramanian@acme.org', 'team_lead', TRUE, 'Ravi Subramanian', 'Lead, Risk & Regulatory Reporting'),
  ('pending:hannah.klein@acme.org',     'hannah.klein@acme.org',     'team_lead', TRUE, 'Hannah Klein',     'Lead, Identity & KYC'),
  ('pending:tobias.larsen@acme.org',    'tobias.larsen@acme.org',    'team_lead', TRUE, 'Tobias Larsen',    'Lead, SRE & Production Engineering'),
  -- Team members (30) — engineers, analysts, designers, QA.
  ('pending:liam.carter@acme.org',         'liam.carter@acme.org',         'team_member', TRUE, 'Liam Carter',         'Senior Backend Engineer'),
  ('pending:emma.donovan@acme.org',        'emma.donovan@acme.org',        'team_member', TRUE, 'Emma Donovan',        'Backend Engineer'),
  ('pending:noah.patel@acme.org',          'noah.patel@acme.org',          'team_member', TRUE, 'Noah Patel',          'Senior Backend Engineer'),
  ('pending:ava.rodriguez@acme.org',       'ava.rodriguez@acme.org',       'team_member', TRUE, 'Ava Rodriguez',       'ML Engineer'),
  ('pending:ethan.nakamura@acme.org',      'ethan.nakamura@acme.org',      'team_member', TRUE, 'Ethan Nakamura',      'Platform Engineer'),
  ('pending:mia.johansson@acme.org',       'mia.johansson@acme.org',       'team_member', TRUE, 'Mia Johansson',       'Compliance Engineer'),
  ('pending:lucas.brennan@acme.org',       'lucas.brennan@acme.org',       'team_member', TRUE, 'Lucas Brennan',       'Security Engineer'),
  ('pending:sophia.mwangi@acme.org',       'sophia.mwangi@acme.org',       'team_member', TRUE, 'Sophia Mwangi',       'SRE'),
  ('pending:mason.reilly@acme.org',        'mason.reilly@acme.org',        'team_member', TRUE, 'Mason Reilly',        'Senior Backend Engineer'),
  ('pending:isabella.park@acme.org',       'isabella.park@acme.org',       'team_member', TRUE, 'Isabella Park',       'Quantitative Analyst'),
  ('pending:logan.whitaker@acme.org',      'logan.whitaker@acme.org',      'team_member', TRUE, 'Logan Whitaker',      'Treasury Systems Engineer'),
  ('pending:charlotte.singh@acme.org',     'charlotte.singh@acme.org',     'team_member', TRUE, 'Charlotte Singh',     'Backend Engineer'),
  ('pending:benjamin.holloway@acme.org',   'benjamin.holloway@acme.org',   'team_member', TRUE, 'Benjamin Holloway',   'Data Engineer'),
  ('pending:amelia.castillo@acme.org',     'amelia.castillo@acme.org',     'team_member', TRUE, 'Amelia Castillo',     'Senior Backend Engineer'),
  ('pending:elijah.okafor@acme.org',       'elijah.okafor@acme.org',       'team_member', TRUE, 'Elijah Okafor',       'Backend Engineer'),
  ('pending:harper.lindgren@acme.org',     'harper.lindgren@acme.org',     'team_member', TRUE, 'Harper Lindgren',     'Mobile Engineer (iOS)'),
  ('pending:james.underwood@acme.org',     'james.underwood@acme.org',     'team_member', TRUE, 'James Underwood',     'Mobile Engineer (Android)'),
  ('pending:evelyn.tanaka@acme.org',       'evelyn.tanaka@acme.org',       'team_member', TRUE, 'Evelyn Tanaka',       'Senior Product Designer'),
  ('pending:alexander.boyd@acme.org',      'alexander.boyd@acme.org',      'team_member', TRUE, 'Alexander Boyd',      'Backend Engineer'),
  ('pending:abigail.fischer@acme.org',     'abigail.fischer@acme.org',     'team_member', TRUE, 'Abigail Fischer',     'QA Automation Engineer'),
  ('pending:daniel.romano@acme.org',       'daniel.romano@acme.org',       'team_member', TRUE, 'Daniel Romano',       'Mobile Engineer (iOS)'),
  ('pending:emily.hartman@acme.org',       'emily.hartman@acme.org',       'team_member', TRUE, 'Emily Hartman',       'Backend Engineer'),
  ('pending:henry.delacroix@acme.org',     'henry.delacroix@acme.org',     'team_member', TRUE, 'Henry Delacroix',     'Release Engineer'),
  ('pending:scarlett.novak@acme.org',      'scarlett.novak@acme.org',      'team_member', TRUE, 'Scarlett Novak',      'API Engineer'),
  ('pending:sebastian.ortega@acme.org',    'sebastian.ortega@acme.org',    'team_member', TRUE, 'Sebastian Ortega',    'Security Engineer'),
  ('pending:lily.karlsson@acme.org',       'lily.karlsson@acme.org',       'team_member', TRUE, 'Lily Karlsson',       'Backend Engineer'),
  ('pending:jackson.ibarra@acme.org',      'jackson.ibarra@acme.org',      'team_member', TRUE, 'Jackson Ibarra',      'Backend Engineer'),
  ('pending:grace.sullivan@acme.org',      'grace.sullivan@acme.org',      'team_member', TRUE, 'Grace Sullivan',      'Senior Data Scientist'),
  ('pending:owen.marchetti@acme.org',      'owen.marchetti@acme.org',      'team_member', TRUE, 'Owen Marchetti',      'Data Engineer'),
  ('pending:zoe.halvorsen@acme.org',       'zoe.halvorsen@acme.org',       'team_member', TRUE, 'Zoe Halvorsen',       'ML Engineer')
ON CONFLICT (email) DO UPDATE
  SET full_name      = EXCLUDED.full_name,
      job_title      = EXCLUDED.job_title,
      role           = EXCLUDED.role,
      is_allocatable = EXCLUDED.is_allocatable;

-- ---------------------------------------------------------------------------
-- 2) Projects + deliverables + assignments + allocations.
--    Wrapped in a DO block so we can resolve email→user_id once and reuse
--    UUIDs across the dozens of inserts that follow.
--
--    The two pg_temp helper functions encapsulate idempotency:
--      * seed_deliverable(...)  inserts (project_id, title) once and reapplies
--        owner / contributor / reviewer assignments under the table's
--        (deliverable_id, user_id, role_on_assignment) UNIQUE constraint.
--      * seed_allocation(...)   inserts a project-level allocation only when
--        no row with the same (user, project, window) already exists.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- Leads (only role allowed to own a project).
  u_olivia   UUID; u_marcus   UUID; u_priya    UUID; u_jonas    UUID; u_amelia_f UUID;
  -- Members (only role allowed on deliverables / allocations).
  u_liam     UUID; u_emma     UUID; u_noah     UUID; u_ava      UUID; u_ethan    UUID;
  u_mia      UUID; u_lucas    UUID; u_sophia   UUID; u_mason    UUID; u_isabella UUID;
  u_logan    UUID; u_charlotte UUID; u_benjamin UUID; u_amelia_c UUID; u_elijah  UUID;
  u_harper   UUID; u_james    UUID; u_evelyn   UUID; u_alexander UUID; u_abigail UUID;
  u_daniel   UUID; u_emily    UUID; u_henry    UUID; u_scarlett UUID; u_sebastian UUID;
  u_lily     UUID; u_jackson  UUID; u_grace    UUID; u_owen     UUID; u_zoe      UUID;
  -- Project ids.
  p_rtp UUID; p_fx UUID; p_app UUID; p_psd2 UUID; p_fraud UUID;
BEGIN
  -- Idempotent deliverable + assignment seeder.
  --
  -- On first run: INSERT a new (project_id, title) row.
  -- On re-run:    UPDATE the existing row's status / due_date so an edited
  --               seed (status re-balancing, schedule slippage, …) propagates
  --               instead of being silently ignored. The lookup key remains
  --               (project_id, title) — change the title and you get a new
  --               deliverable, not a renamed one. Assignments are still
  --               reapplied under the table's (deliverable_id, user_id,
  --               role_on_assignment) UNIQUE constraint.
  CREATE OR REPLACE FUNCTION pg_temp.seed_deliverable(
    p_project       UUID,
    p_title         TEXT,
    p_status        TEXT,
    p_due           DATE,
    p_owner         UUID,
    p_contributors  UUID[]  DEFAULT NULL,
    p_reviewer      UUID    DEFAULT NULL
  ) RETURNS UUID AS $body$
  DECLARE
    d_id UUID;
    c    UUID;
  BEGIN
    SELECT id INTO d_id
      FROM deliverables
     WHERE project_id = p_project AND title = p_title;
    IF d_id IS NULL THEN
      INSERT INTO deliverables (project_id, title, status, due_date)
      VALUES (p_project, p_title, p_status, p_due)
      RETURNING id INTO d_id;
    ELSE
      UPDATE deliverables
         SET status = p_status, due_date = p_due, updated_at = NOW()
       WHERE id = d_id;
    END IF;
    IF p_owner IS NOT NULL THEN
      INSERT INTO assignments (deliverable_id, user_id, role_on_assignment)
      VALUES (d_id, p_owner, 'owner')
      ON CONFLICT (deliverable_id, user_id, role_on_assignment) DO NOTHING;
    END IF;
    IF p_contributors IS NOT NULL THEN
      FOREACH c IN ARRAY p_contributors LOOP
        INSERT INTO assignments (deliverable_id, user_id, role_on_assignment)
        VALUES (d_id, c, 'contributor')
        ON CONFLICT (deliverable_id, user_id, role_on_assignment) DO NOTHING;
      END LOOP;
    END IF;
    IF p_reviewer IS NOT NULL THEN
      INSERT INTO assignments (deliverable_id, user_id, role_on_assignment)
      VALUES (d_id, p_reviewer, 'reviewer')
      ON CONFLICT (deliverable_id, user_id, role_on_assignment) DO NOTHING;
    END IF;
    RETURN d_id;
  END;
  $body$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION pg_temp.seed_allocation(
    p_user    UUID,
    p_project UUID,
    p_role    TEXT,
    p_start   DATE,
    p_end     DATE
  ) RETURNS VOID AS $body$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM allocations
       WHERE user_id    = p_user
         AND project_id = p_project
         AND start_date = p_start
         AND end_date   = p_end
    ) THEN
      INSERT INTO allocations
        (user_id, project_id, role_description, start_date, end_date, approval_status)
      VALUES
        (p_user, p_project, p_role, p_start, p_end, 'approved');
    END IF;
  END;
  $body$ LANGUAGE plpgsql;

  -- Idempotent equipment seeder. Items can be project-only (pass
  -- p_deliverable_title = NULL) or attached to a specific deliverable, in
  -- which case the deliverable_id is resolved by (project_id, title).
  -- Idempotency key: (name, assigned_project_id). Re-running updates
  -- status / approval_status / cost / currency / deliverable link so
  -- changes here propagate on subsequent migrations.
  CREATE OR REPLACE FUNCTION pg_temp.seed_equipment(
    p_name                TEXT,
    p_kind                TEXT,
    p_is_tangible         BOOLEAN,
    p_cost                NUMERIC,
    p_currency            TEXT,
    p_project             UUID,
    p_deliverable_title   TEXT,
    p_status              TEXT,
    p_approval_status     TEXT
  ) RETURNS VOID AS $body$
  DECLARE
    d_id UUID;
    e_id UUID;
  BEGIN
    IF p_deliverable_title IS NOT NULL THEN
      SELECT id INTO d_id
        FROM deliverables
       WHERE project_id = p_project AND title = p_deliverable_title;
    END IF;
    SELECT id INTO e_id
      FROM equipment
     WHERE name = p_name AND assigned_project_id = p_project;
    IF e_id IS NULL THEN
      INSERT INTO equipment
        (name, kind, is_tangible, cost, currency,
         assigned_project_id, assigned_deliverable_id,
         status, approval_status)
      VALUES
        (p_name, p_kind, p_is_tangible, p_cost, p_currency,
         p_project, d_id,
         p_status, p_approval_status);
    ELSE
      UPDATE equipment
         SET kind                    = p_kind,
             is_tangible             = p_is_tangible,
             cost                    = p_cost,
             currency                = p_currency,
             assigned_deliverable_id = d_id,
             status                  = p_status,
             approval_status         = p_approval_status,
             updated_at              = NOW()
       WHERE id = e_id;
    END IF;
  END;
  $body$ LANGUAGE plpgsql;

  -- Idempotent dependency seeder. Wires (child.depends_on -> parent) where
  -- both are looked up by (project_id, title). Skips when either title is
  -- missing on the project (defensive — the migration owns the seed so a
  -- typo would catch a NULL UPDATE and fail loudly via the FK constraint
  -- check below). Refuses to set a row to depend on itself or to introduce
  -- a cycle by walking the existing chain upward.
  CREATE OR REPLACE FUNCTION pg_temp.seed_dependency(
    p_project       UUID,
    p_child_title   TEXT,
    p_parent_title  TEXT
  ) RETURNS VOID AS $body$
  DECLARE
    child_id  UUID;
    parent_id UUID;
    seen      UUID[] := ARRAY[]::UUID[];
    node      UUID;
  BEGIN
    SELECT id INTO child_id  FROM deliverables WHERE project_id = p_project AND title = p_child_title;
    SELECT id INTO parent_id FROM deliverables WHERE project_id = p_project AND title = p_parent_title;
    IF child_id IS NULL OR parent_id IS NULL THEN
      RAISE EXCEPTION 'seed_dependency: missing deliverable on project % (child=%, parent=%)',
        p_project, p_child_title, p_parent_title;
    END IF;
    IF child_id = parent_id THEN
      RAISE EXCEPTION 'seed_dependency: deliverable cannot depend on itself (%)', p_child_title;
    END IF;
    -- Walk parent's chain upward; if child appears, the new edge would
    -- create a cycle.
    node := parent_id;
    WHILE node IS NOT NULL AND NOT (node = ANY(seen)) LOOP
      IF node = child_id THEN
        RAISE EXCEPTION 'seed_dependency: cycle (% -> %)', p_child_title, p_parent_title;
      END IF;
      seen := seen || node;
      SELECT depends_on INTO node FROM deliverables WHERE id = node;
    END LOOP;
    UPDATE deliverables SET depends_on = parent_id, updated_at = NOW()
     WHERE id = child_id AND (depends_on IS DISTINCT FROM parent_id);
  END;
  $body$ LANGUAGE plpgsql;

  -- Resolve email → id once.
  SELECT id INTO u_olivia    FROM users WHERE email = 'olivia.bennett@acme.org';
  SELECT id INTO u_marcus    FROM users WHERE email = 'marcus.chen@acme.org';
  SELECT id INTO u_priya     FROM users WHERE email = 'priya.raman@acme.org';
  SELECT id INTO u_jonas     FROM users WHERE email = 'jonas.weber@acme.org';
  SELECT id INTO u_amelia_f  FROM users WHERE email = 'amelia.foster@acme.org';

  SELECT id INTO u_liam      FROM users WHERE email = 'liam.carter@acme.org';
  SELECT id INTO u_emma      FROM users WHERE email = 'emma.donovan@acme.org';
  SELECT id INTO u_noah      FROM users WHERE email = 'noah.patel@acme.org';
  SELECT id INTO u_ava       FROM users WHERE email = 'ava.rodriguez@acme.org';
  SELECT id INTO u_ethan     FROM users WHERE email = 'ethan.nakamura@acme.org';
  SELECT id INTO u_mia       FROM users WHERE email = 'mia.johansson@acme.org';
  SELECT id INTO u_lucas     FROM users WHERE email = 'lucas.brennan@acme.org';
  SELECT id INTO u_sophia    FROM users WHERE email = 'sophia.mwangi@acme.org';
  SELECT id INTO u_mason     FROM users WHERE email = 'mason.reilly@acme.org';
  SELECT id INTO u_isabella  FROM users WHERE email = 'isabella.park@acme.org';
  SELECT id INTO u_logan     FROM users WHERE email = 'logan.whitaker@acme.org';
  SELECT id INTO u_charlotte FROM users WHERE email = 'charlotte.singh@acme.org';
  SELECT id INTO u_benjamin  FROM users WHERE email = 'benjamin.holloway@acme.org';
  SELECT id INTO u_amelia_c  FROM users WHERE email = 'amelia.castillo@acme.org';
  SELECT id INTO u_elijah    FROM users WHERE email = 'elijah.okafor@acme.org';
  SELECT id INTO u_harper    FROM users WHERE email = 'harper.lindgren@acme.org';
  SELECT id INTO u_james     FROM users WHERE email = 'james.underwood@acme.org';
  SELECT id INTO u_evelyn    FROM users WHERE email = 'evelyn.tanaka@acme.org';
  SELECT id INTO u_alexander FROM users WHERE email = 'alexander.boyd@acme.org';
  SELECT id INTO u_abigail   FROM users WHERE email = 'abigail.fischer@acme.org';
  SELECT id INTO u_daniel    FROM users WHERE email = 'daniel.romano@acme.org';
  SELECT id INTO u_emily     FROM users WHERE email = 'emily.hartman@acme.org';
  SELECT id INTO u_henry     FROM users WHERE email = 'henry.delacroix@acme.org';
  SELECT id INTO u_scarlett  FROM users WHERE email = 'scarlett.novak@acme.org';
  SELECT id INTO u_sebastian FROM users WHERE email = 'sebastian.ortega@acme.org';
  SELECT id INTO u_lily      FROM users WHERE email = 'lily.karlsson@acme.org';
  SELECT id INTO u_jackson   FROM users WHERE email = 'jackson.ibarra@acme.org';
  SELECT id INTO u_grace     FROM users WHERE email = 'grace.sullivan@acme.org';
  SELECT id INTO u_owen      FROM users WHERE email = 'owen.marchetti@acme.org';
  SELECT id INTO u_zoe       FROM users WHERE email = 'zoe.halvorsen@acme.org';

  -- =========================================================================
  -- Project 1 (LARGE, 12 months, 20 deliverables)
  -- Global Real-Time Payments Platform — owner: Olivia Bennett
  -- =========================================================================
  SELECT id INTO p_rtp FROM projects WHERE name = 'Global Real-Time Payments Platform';
  IF p_rtp IS NULL THEN
    INSERT INTO projects (name, description, status, start_date, target_end_date, owner_id, budget_amount, budget_currency)
    VALUES (
      'Global Real-Time Payments Platform',
      'Build a unified real-time payments core supporting ISO 20022, US FedNow, '
      'EU SEPA Instant (SCT Inst), UK Faster Payments (FPS), and SWIFT gpi tracking. '
      'Multi-currency ledger, idempotent rails, AML/OFAC screening, and 5,000 TPS p99 < 2s.',
      'active', DATE '2026-02-01', DATE '2027-02-01', u_olivia, 4500000, 'USD'
    ) RETURNING id INTO p_rtp;
  END IF;

  PERFORM pg_temp.seed_deliverable(p_rtp, 'ISO 20022 message schema mapping (pacs.008 / pain.001)',     'done',        DATE '2026-03-01', u_liam,    ARRAY[u_emma]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'FedNow ISO 20022 connector integration',                      'done',        DATE '2026-04-15', u_noah,    ARRAY[u_liam]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'SEPA Instant Credit Transfer (SCT Inst) gateway',             'done',        DATE '2026-06-30', u_ava,     ARRAY[u_ethan]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'UK Faster Payments (FPS) integration',                        'done',        DATE '2026-07-15', u_mia,     ARRAY[u_ava]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'SWIFT gpi tracker API integration',                           'done',        DATE '2026-07-30', u_lucas,   ARRAY[u_sophia]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Payment validation rules engine',                             'done',        DATE '2026-08-15', u_emma,    ARRAY[u_liam]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Idempotency key + retry framework',                           'done',        DATE '2026-08-30', u_ethan,   NULL);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'End-to-end payment status webhook fan-out',                   'done',        DATE '2026-09-15', u_sophia,  NULL);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Multi-currency ledger posting service',                       'done',        DATE '2026-09-30', u_noah,    ARRAY[u_emma]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'PCI-DSS scope review and PAN tokenization',                   'in_progress', DATE '2026-10-15', u_lucas,   NULL);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'AML transaction screening (OFAC / UN / EU consolidated)',     'in_progress', DATE '2026-10-30', u_mia,     ARRAY[u_sophia]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Real-time fraud signal feed integration',                     'in_progress', DATE '2026-11-15', u_ava,     NULL);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Settlement reconciliation batch (intraday + EOD)',            'in_progress', DATE '2026-11-30', u_emma,    NULL);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Operator NOC dashboard for live payment flow',                'in_progress', DATE '2026-12-15', u_liam,    ARRAY[u_noah]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Disaster-recovery runbook + chaos drill',                     'blocked',     DATE '2026-12-30', u_ethan,   NULL);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'SOC 2 Type II evidence collection',                           'blocked',     DATE '2027-01-10', u_lucas,   NULL);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Performance test: 5,000 TPS sustained, p99 < 2s',             'cancelled',   DATE '2027-01-15', u_sophia,  ARRAY[u_ethan]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Hosted-customer onboarding playbook',                         'cancelled',   DATE '2027-01-22', u_mia,     NULL);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Production cutover + dual-run window',                        'todo',        DATE '2027-01-29', u_noah,    ARRAY[u_liam, u_ava]);
  PERFORM pg_temp.seed_deliverable(p_rtp, 'Post-launch optimisation + KPI review',                       'todo',        DATE '2027-02-01', u_emma,    NULL);

  PERFORM pg_temp.seed_allocation(u_liam,   p_rtp, 'Tech lead, payment rails',         DATE '2026-02-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_emma,   p_rtp, 'Backend engineer, rules + ledger', DATE '2026-02-15', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_noah,   p_rtp, 'Backend engineer, FedNow + ledger',DATE '2026-02-15', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_ava,    p_rtp, 'Backend engineer, SEPA Instant',   DATE '2026-04-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_ethan,  p_rtp, 'Platform engineer',                DATE '2026-04-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_mia,    p_rtp, 'Compliance engineer (AML)',        DATE '2026-05-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_lucas,  p_rtp, 'Security engineer (PCI-DSS)',      DATE '2026-06-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_sophia, p_rtp, 'SRE (load + DR)',                  DATE '2026-06-01', DATE '2027-02-01');

  -- Equipment (tangibles + intangibles) charged to RTP. Mixed approval
  -- statuses; one rejected legacy gateway demonstrates that rejected rows
  -- never draw against the budget.
  PERFORM pg_temp.seed_equipment('Thales payShield 10K HSM cluster (×2)',     'hardware-security-module', TRUE,  180000, 'USD', p_rtp, NULL,                                                                  'in_use',      'approved');
  PERFORM pg_temp.seed_equipment('SWIFT gpi tracker subscription (annual)',   'service-subscription',     FALSE,  48000, 'USD', p_rtp, 'SWIFT gpi tracker API integration',                                   'in_use',      'approved');
  PERFORM pg_temp.seed_equipment('Datadog APM Pro (24 engineer seats)',       'observability-license',    FALSE,  36000, 'USD', p_rtp, NULL,                                                                  'in_use',      'approved');
  PERFORM pg_temp.seed_equipment('Confluent Kafka Cloud cluster',             'infrastructure-saas',      FALSE,  42000, 'USD', p_rtp, NULL,                                                                  'in_use',      'approved');
  PERFORM pg_temp.seed_equipment('Engineer workstations (MacBook Pro M3, ×8)','developer-workstation',    TRUE,   24000, 'USD', p_rtp, NULL,                                                                  'in_use',      'approved');
  PERFORM pg_temp.seed_equipment('QSA-led PCI-DSS audit engagement (Q4)',     'compliance-audit',         FALSE,  65000, 'USD', p_rtp, 'PCI-DSS scope review and PAN tokenization',                           'available',   'pending');
  PERFORM pg_temp.seed_equipment('k6 Cloud load-test plan',                   'performance-testing',      FALSE,  18000, 'USD', p_rtp, 'Performance test: 5,000 TPS sustained, p99 < 2s',                     'available',   'approved');
  PERFORM pg_temp.seed_equipment('SWIFT Alliance Gateway (legacy test box)',  'network-appliance',        TRUE,   12000, 'USD', p_rtp, NULL,                                                                  'retired',     'rejected');

  -- =========================================================================
  -- Project 2 (LARGE, 9 months, 18 deliverables)
  -- Cross-Border FX Settlement Engine — owner: Marcus Chen
  -- =========================================================================
  SELECT id INTO p_fx FROM projects WHERE name = 'Cross-Border FX Settlement Engine';
  IF p_fx IS NULL THEN
    INSERT INTO projects (name, description, status, start_date, target_end_date, owner_id, budget_amount, budget_currency)
    VALUES (
      'Cross-Border FX Settlement Engine',
      'Multi-currency FX trading and settlement platform: G10 + EM currency pairs, '
      'CLS member integration, nostro reconciliation, T+0 / T+1 / T+2 windows, '
      'SWIFT MT300/MT320 confirmations, EMIR / Dodd-Frank trade reporting.',
      'active', DATE '2026-03-01', DATE '2026-12-01', u_marcus, 2800000, 'USD'
    ) RETURNING id INTO p_fx;
  END IF;

  PERFORM pg_temp.seed_deliverable(p_fx, 'FX rate provider integration (Refinitiv + Bloomberg)',     'done',        DATE '2026-04-01', u_mason,    NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Currency pair coverage matrix (G10 + EM)',                  'done',        DATE '2026-04-15', u_isabella, NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'CLS settlement member onboarding',                          'done',        DATE '2026-05-30', u_logan,    NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Nostro account reconciliation service',                     'done',        DATE '2026-06-15', u_charlotte,ARRAY[u_benjamin]);
  PERFORM pg_temp.seed_deliverable(p_fx, 'T+0 / T+1 / T+2 settlement window engine',                  'done',        DATE '2026-06-30', u_amelia_c, NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Pre-trade FX quote API',                                    'done',        DATE '2026-07-15', u_elijah,   ARRAY[u_mason]);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Hedge ticket auto-generation for treasury',                 'done',        DATE '2026-07-30', u_isabella, NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Multi-leg netting calculator',                              'done',        DATE '2026-08-15', u_logan,    ARRAY[u_charlotte]);
  PERFORM pg_temp.seed_deliverable(p_fx, 'ISO 4217 currency reference data service',                  'done',        DATE '2026-08-30', u_benjamin, NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Sanctions screening on settlement counterparty',            'in_progress', DATE '2026-09-15', u_amelia_c, ARRAY[u_elijah]);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Settlement risk dashboard (Herstatt exposure)',             'in_progress', DATE '2026-09-30', u_mason,    NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'SWIFT MT300 / MT320 confirmation generator',                'in_progress', DATE '2026-10-15', u_isabella, ARRAY[u_logan]);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Regulatory reporting: EMIR + Dodd-Frank trade repository',  'in_progress', DATE '2026-10-30', u_charlotte,NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'FX rate slippage analytics',                                'blocked',     DATE '2026-11-10', u_benjamin, NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Disaster scenario: CLS outage failover',                    'blocked',     DATE '2026-11-20', u_amelia_c, NULL);
  PERFORM pg_temp.seed_deliverable(p_fx, 'UAT with treasury desks (London + Singapore + New York)',   'todo',        DATE '2026-11-25', u_elijah,   ARRAY[u_mason]);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Production rollout (cohort by region)',                     'todo',        DATE '2026-11-30', u_logan,    ARRAY[u_isabella, u_charlotte]);
  PERFORM pg_temp.seed_deliverable(p_fx, 'Post-go-live performance review',                           'cancelled',   DATE '2026-12-01', u_benjamin, NULL);

  PERFORM pg_temp.seed_allocation(u_mason,    p_fx, 'Tech lead, FX quoting',         DATE '2026-03-01', DATE '2026-12-01');
  PERFORM pg_temp.seed_allocation(u_isabella, p_fx, 'Quant analyst, pricing + risk', DATE '2026-03-01', DATE '2026-12-01');
  PERFORM pg_temp.seed_allocation(u_logan,    p_fx, 'CLS / SWIFT integration',       DATE '2026-03-15', DATE '2026-12-01');
  PERFORM pg_temp.seed_allocation(u_charlotte,p_fx, 'Backend engineer, recon',       DATE '2026-04-01', DATE '2026-12-01');
  PERFORM pg_temp.seed_allocation(u_benjamin, p_fx, 'Data engineer, reference data', DATE '2026-04-15', DATE '2026-12-01');
  PERFORM pg_temp.seed_allocation(u_amelia_c, p_fx, 'Backend engineer, settlement',  DATE '2026-04-15', DATE '2026-12-01');
  PERFORM pg_temp.seed_allocation(u_elijah,   p_fx, 'Backend engineer, quote API',   DATE '2026-05-01', DATE '2026-12-01');

  -- Equipment charged to FX.
  PERFORM pg_temp.seed_equipment('Refinitiv Eikon (10 seats, annual)',     'market-data-license',   FALSE, 124000, 'USD', p_fx, 'FX rate provider integration (Refinitiv + Bloomberg)', 'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Bloomberg Terminal subscriptions (×4)',  'market-data-license',   FALSE,  96000, 'USD', p_fx, 'FX rate provider integration (Refinitiv + Bloomberg)', 'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('CLSNet test-environment access',         'settlement-network',    FALSE,  28000, 'USD', p_fx, 'CLS settlement member onboarding',                     'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Quant analyst workstations (Linux, ×4)', 'developer-workstation', TRUE,   14000, 'USD', p_fx, NULL,                                                   'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Volante SWIFT MT message validator',     'messaging-tool',        FALSE,  22000, 'USD', p_fx, 'SWIFT MT300 / MT320 confirmation generator',           'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('REGIS-TR EMIR reporting connector',      'regulatory-reporting',  FALSE,  34000, 'USD', p_fx, 'Regulatory reporting: EMIR + Dodd-Frank trade repository','available','pending');

  -- =========================================================================
  -- Project 3 (LARGE, 10 months, 18 deliverables)
  -- Mobile Banking Super-App (Multi-Region) — owner: Priya Raman
  -- =========================================================================
  SELECT id INTO p_app FROM projects WHERE name = 'Mobile Banking Super-App (Multi-Region)';
  IF p_app IS NULL THEN
    INSERT INTO projects (name, description, status, start_date, target_end_date, owner_id, budget_amount, budget_currency)
    VALUES (
      'Mobile Banking Super-App (Multi-Region)',
      'Next-generation iOS / Android / web banking experience for the US, UK, EU, '
      'and APAC markets. Accounts, cards, payments, FX, investments, in-app KYC, '
      'localised regulatory variants (Reg E, PSD2/SCA, MAS, UPI, PIX), WCAG 2.2 AA.',
      'active', DATE '2026-04-01', DATE '2027-02-01', u_priya, 5200000, 'USD'
    ) RETURNING id INTO p_app;
  END IF;

  PERFORM pg_temp.seed_deliverable(p_app, 'Design system + localisation framework',                              'done',        DATE '2026-05-15', u_harper,    NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'Biometric auth + step-up MFA (FIDO2 / WebAuthn)',                     'done',        DATE '2026-06-01', u_james,     ARRAY[u_evelyn]);
  PERFORM pg_temp.seed_deliverable(p_app, 'Account aggregation (Plaid / Tink / Yodlee)',                         'done',        DATE '2026-06-30', u_alexander, NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'Card management (freeze / unfreeze, PIN reset, virtual cards)',       'done',        DATE '2026-07-15', u_abigail,   ARRAY[u_daniel]);
  PERFORM pg_temp.seed_deliverable(p_app, 'P2P transfer (Zelle / Pay-by-Bank / PIX / UPI)',                      'done',        DATE '2026-07-30', u_emily,     ARRAY[u_henry]);
  PERFORM pg_temp.seed_deliverable(p_app, 'International wire transfer wizard',                                  'done',        DATE '2026-08-15', u_harper,    ARRAY[u_alexander]);
  PERFORM pg_temp.seed_deliverable(p_app, 'Bill pay + e-invoice ingestion',                                      'done',        DATE '2026-08-30', u_james,     NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'FX currency conversion in-app',                                       'done',        DATE '2026-09-15', u_evelyn,    ARRAY[u_abigail]);
  PERFORM pg_temp.seed_deliverable(p_app, 'Investments tab: brokerage + ETF marketplace',                        'done',        DATE '2026-09-30', u_daniel,    NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'Robo-advisor portfolio recommendations',                              'in_progress', DATE '2026-10-15', u_emily,     ARRAY[u_henry]);
  PERFORM pg_temp.seed_deliverable(p_app, 'Push notifications + secure messaging center',                        'in_progress', DATE '2026-10-30', u_alexander, NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'Accessibility audit (WCAG 2.2 AA)',                                   'in_progress', DATE '2026-11-15', u_harper,    NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'Regional regulatory variants (Reg E, PSD2/SCA, MAS, UPI, PIX)',       'in_progress', DATE '2026-11-30', u_abigail,   ARRAY[u_james]);
  PERFORM pg_temp.seed_deliverable(p_app, 'App Store + Play Store release pipelines',                            'blocked',     DATE '2026-12-10', u_henry,     NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'In-app KYC re-verification flow',                                     'blocked',     DATE '2026-12-20', u_evelyn,    NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'Privacy: GDPR / CCPA / LGPD data export and delete',                  'todo',        DATE '2027-01-05', u_daniel,    ARRAY[u_emily]);
  PERFORM pg_temp.seed_deliverable(p_app, 'Performance budget enforcement (cold start < 2s)',                    'todo',        DATE '2027-01-20', u_alexander, NULL);
  PERFORM pg_temp.seed_deliverable(p_app, 'Phased rollout: US → UK → EU → APAC',                                 'cancelled',   DATE '2027-02-01', u_harper,    ARRAY[u_james, u_abigail]);

  PERFORM pg_temp.seed_allocation(u_harper,    p_app, 'iOS tech lead',                  DATE '2026-04-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_james,     p_app, 'Android tech lead',              DATE '2026-04-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_evelyn,    p_app, 'Senior product designer',        DATE '2026-04-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_alexander, p_app, 'Backend engineer, aggregation',  DATE '2026-04-15', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_abigail,   p_app, 'QA automation, multi-region',    DATE '2026-05-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_daniel,    p_app, 'iOS engineer, cards + invest',   DATE '2026-05-01', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_emily,     p_app, 'Backend engineer, P2P + advisor',DATE '2026-05-15', DATE '2027-02-01');
  PERFORM pg_temp.seed_allocation(u_henry,     p_app, 'Release engineer',               DATE '2026-06-01', DATE '2027-02-01');

  -- Equipment charged to the Mobile Banking Super-App.
  PERFORM pg_temp.seed_equipment('Sauce Labs real-device cloud (annual)',         'device-farm',         FALSE,  72000, 'USD', p_app, NULL,                                                'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Apple Developer Enterprise seats (×10)',        'platform-license',    FALSE,   9900, 'USD', p_app, NULL,                                                'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Google Play Console (organisation tier)',       'platform-license',    FALSE,   6000, 'USD', p_app, NULL,                                                'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('iPhone test fleet (15 / 14 / 12, ×12)',         'mobile-test-device',  TRUE,   14400, 'USD', p_app, NULL,                                                'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Android test fleet (Pixel / Samsung / OnePlus, ×12)','mobile-test-device', TRUE, 12000, 'USD', p_app, NULL,                                              'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('YubiKey 5C NFC security keys (×30)',            'security-hardware',   TRUE,    1800, 'USD', p_app, 'Biometric auth + step-up MFA (FIDO2 / WebAuthn)',   'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Figma Enterprise (organisation plan, annual)',  'design-tool',         FALSE,  42000, 'USD', p_app, 'Design system + localisation framework',            'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Deque axe DevTools Pro (10 seats)',             'accessibility-tooling',FALSE,   9500, 'USD', p_app, 'Accessibility audit (WCAG 2.2 AA)',                 'available', 'pending');

  -- =========================================================================
  -- Project 4 (SMALL, 4 months, 11 deliverables)
  -- PSD2 / Open Banking API Compliance Refresh — owner: Jonas Weber
  -- =========================================================================
  SELECT id INTO p_psd2 FROM projects WHERE name = 'PSD2 / Open Banking API Compliance Refresh';
  IF p_psd2 IS NULL THEN
    INSERT INTO projects (name, description, status, start_date, target_end_date, owner_id, budget_amount, budget_currency)
    VALUES (
      'PSD2 / Open Banking API Compliance Refresh',
      'EU + UK regulatory refresh: re-certify against Berlin Group NextGenPSD2 v1.3 '
      'and UK OBIE v3.1.11, rotate eIDAS QWAC/QSealC certificates, ship new SCA '
      'decoupled flow, and migrate TPPs to the v3 AIS/PIS endpoints.',
      'active', DATE '2026-05-01', DATE '2026-09-01', u_jonas, 850000, 'EUR'
    ) RETURNING id INTO p_psd2;
  END IF;

  PERFORM pg_temp.seed_deliverable(p_psd2, 'PSD2 RTS-SCA gap assessment',                          'done',        DATE '2026-05-20', u_scarlett,  NULL);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'eIDAS QWAC / QSealC certificate rotation',             'done',        DATE '2026-06-01', u_sebastian, NULL);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'Strong Customer Authentication (SCA) decoupled flow', 'done',        DATE '2026-06-15', u_lily,      ARRAY[u_jackson]);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'Account Information Service (AIS) endpoints v3',      'done',        DATE '2026-06-30', u_scarlett,  ARRAY[u_sebastian]);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'Payment Initiation Service (PIS) endpoints v3',       'done',        DATE '2026-07-10', u_jackson,   NULL);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'Confirmation of Funds (CoF) endpoint',                 'done',        DATE '2026-07-20', u_lily,      NULL);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'Berlin Group NextGenPSD2 compatibility tests',         'done',        DATE '2026-07-31', u_sebastian, ARRAY[u_scarlett]);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'UK OBIE conformance suite re-certification',           'in_progress', DATE '2026-08-10', u_jackson,   ARRAY[u_lily]);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'TPP onboarding portal updates',                        'in_progress', DATE '2026-08-20', u_scarlett,  NULL);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'Production rollout + dual-version window',             'blocked',     DATE '2026-08-28', u_sebastian, ARRAY[u_lily, u_jackson]);
  PERFORM pg_temp.seed_deliverable(p_psd2, 'EBA reporting confirmation',                           'todo',        DATE '2026-09-01', u_scarlett,  NULL);

  PERFORM pg_temp.seed_allocation(u_scarlett,  p_psd2, 'API engineer, AIS + TPP portal',      DATE '2026-05-01', DATE '2026-09-01');
  PERFORM pg_temp.seed_allocation(u_sebastian, p_psd2, 'Security engineer, eIDAS + compat',   DATE '2026-05-01', DATE '2026-09-01');
  PERFORM pg_temp.seed_allocation(u_lily,      p_psd2, 'Backend engineer, SCA + CoF',         DATE '2026-05-15', DATE '2026-09-01');
  PERFORM pg_temp.seed_allocation(u_jackson,   p_psd2, 'Backend engineer, PIS + OBIE',        DATE '2026-05-15', DATE '2026-09-01');

  -- Equipment charged to PSD2 (EUR-denominated project).
  PERFORM pg_temp.seed_equipment('eIDAS QWAC + QSealC certificates (annual)',  'security-certificate',    FALSE, 18000, 'EUR', p_psd2, 'eIDAS QWAC / QSealC certificate rotation',         'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Berlin Group conformance test suite',         'compliance-tooling',      FALSE, 26000, 'EUR', p_psd2, 'Berlin Group NextGenPSD2 compatibility tests',     'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('OBIE Open Banking conformance tool',          'compliance-tooling',      FALSE, 22000, 'EUR', p_psd2, 'UK OBIE conformance suite re-certification',       'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Kong Enterprise API Gateway license',         'infrastructure-license',  FALSE, 48000, 'EUR', p_psd2, NULL,                                               'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Engineer workstations (×4)',                  'developer-workstation',   TRUE,  12000, 'EUR', p_psd2, NULL,                                               'in_use',    'approved');

  -- =========================================================================
  -- Project 5 (SMALL, 5 months, 12 deliverables)
  -- Fraud Detection ML Model Upgrade — owner: Amelia Foster
  -- =========================================================================
  SELECT id INTO p_fraud FROM projects WHERE name = 'Fraud Detection ML Model Upgrade';
  IF p_fraud IS NULL THEN
    INSERT INTO projects (name, description, status, start_date, target_end_date, owner_id, budget_amount, budget_currency)
    VALUES (
      'Fraud Detection ML Model Upgrade',
      'Replace the legacy gradient-boosted fraud model with a sequence + graph '
      'hybrid: card-present LSTM, mule-account graph features, real-time scoring '
      '< 50ms p99, AML / SAR rule layer (FinCEN, FCA, EBA), SR 11-7 governance.',
      'active', DATE '2026-06-01', DATE '2026-10-31', u_amelia_f, 1100000, 'USD'
    ) RETURNING id INTO p_fraud;
  END IF;

  PERFORM pg_temp.seed_deliverable(p_fraud, 'Feature store audit + lineage documentation',              'done',        DATE '2026-06-20', u_grace,  NULL);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Historical transaction data lake refresh',                  'done',        DATE '2026-07-05', u_owen,   ARRAY[u_zoe]);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Baseline model (gradient-boosted) retraining',              'done',        DATE '2026-07-20', u_zoe,    NULL);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Sequence model (LSTM) for card-present fraud',              'done',        DATE '2026-08-05', u_liam,   ARRAY[u_grace]);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Graph features for mule-account detection',                 'done',        DATE '2026-08-20', u_ava,    ARRAY[u_owen]);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'AML / SAR rule layer integration (FinCEN, FCA, EBA)',       'done',        DATE '2026-09-01', u_grace,  NULL);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Real-time scoring service (< 50ms p99)',                    'done',        DATE '2026-09-15', u_zoe,    ARRAY[u_liam]);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Model explainability dashboard (SHAP)',                     'in_progress', DATE '2026-09-25', u_owen,   NULL);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'A/B test framework: champion vs. challenger',               'in_progress', DATE '2026-10-05', u_ava,    NULL);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Cross-border transaction risk scoring',                     'todo',        DATE '2026-10-15', u_grace,  ARRAY[u_zoe]);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Model risk governance (SR 11-7) sign-off pack',             'blocked',     DATE '2026-10-25', u_owen,   NULL);
  PERFORM pg_temp.seed_deliverable(p_fraud, 'Production deployment + shadow mode',                       'cancelled',   DATE '2026-10-31', u_zoe,    ARRAY[u_liam, u_ava]);

  PERFORM pg_temp.seed_allocation(u_grace, p_fraud, 'Senior data scientist',          DATE '2026-06-01', DATE '2026-10-31');
  PERFORM pg_temp.seed_allocation(u_owen,  p_fraud, 'Data engineer',                  DATE '2026-06-01', DATE '2026-10-31');
  PERFORM pg_temp.seed_allocation(u_zoe,   p_fraud, 'ML engineer, scoring + models',  DATE '2026-06-15', DATE '2026-10-31');
  -- Two cross-team members from the RTP project (Liam, Ava) lend bandwidth
  -- to the fraud upgrade. Realistic — fraud signals feed back into payments.
  PERFORM pg_temp.seed_allocation(u_liam,  p_fraud, 'Cross-team: LSTM + scoring',     DATE '2026-08-01', DATE '2026-10-31');
  PERFORM pg_temp.seed_allocation(u_ava,   p_fraud, 'Cross-team: graph + A/B',        DATE '2026-08-01', DATE '2026-10-31');

  -- Equipment charged to the Fraud ML upgrade. One rejected Cloudera trial
  -- left in place to show the budget gate skipping rejected rows.
  PERFORM pg_temp.seed_equipment('NVIDIA A100 GPU compute reservation (3 mo)',  'compute-reservation',   FALSE, 84000, 'USD', p_fraud, 'Sequence model (LSTM) for card-present fraud',     'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Databricks Lakehouse Pro (annual)',           'data-platform',         FALSE, 96000, 'USD', p_fraud, 'Historical transaction data lake refresh',         'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Neo4j Enterprise license',                    'graph-database',        FALSE, 42000, 'USD', p_fraud, 'Graph features for mule-account detection',        'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('MLflow + SHAP enterprise support',            'ml-tooling',            FALSE, 18000, 'USD', p_fraud, 'Model explainability dashboard (SHAP)',            'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Data science workstations (×4)',              'developer-workstation', TRUE,  16000, 'USD', p_fraud, NULL,                                               'in_use',    'approved');
  PERFORM pg_temp.seed_equipment('Cloudera Data Flow trial (vendor eval)',      'data-platform',         FALSE, 24000, 'USD', p_fraud, NULL,                                               'available', 'rejected');

  -- =========================================================================
  -- Deliverable dependency graph (powers /reports-service/deliverable-chain).
  -- One depends_on parent per child; the report walks these recursively into
  -- a per-project tree. Idempotent: seed_dependency only writes when the
  -- current value differs, so re-running the migration is a no-op once the
  -- graph is in place. Roots are listed implicitly — any deliverable that
  -- does not appear as a `child_title` argument below stays at depth 0.
  -- =========================================================================

  -- ---- Project 1: Global Real-Time Payments Platform (root: ISO 20022 …) --
  PERFORM pg_temp.seed_dependency(p_rtp, 'FedNow ISO 20022 connector integration',                  'ISO 20022 message schema mapping (pacs.008 / pain.001)');
  PERFORM pg_temp.seed_dependency(p_rtp, 'SEPA Instant Credit Transfer (SCT Inst) gateway',         'ISO 20022 message schema mapping (pacs.008 / pain.001)');
  PERFORM pg_temp.seed_dependency(p_rtp, 'UK Faster Payments (FPS) integration',                    'ISO 20022 message schema mapping (pacs.008 / pain.001)');
  PERFORM pg_temp.seed_dependency(p_rtp, 'SWIFT gpi tracker API integration',                       'FedNow ISO 20022 connector integration');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Payment validation rules engine',                         'ISO 20022 message schema mapping (pacs.008 / pain.001)');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Idempotency key + retry framework',                       'Payment validation rules engine');
  PERFORM pg_temp.seed_dependency(p_rtp, 'End-to-end payment status webhook fan-out',               'Idempotency key + retry framework');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Multi-currency ledger posting service',                   'Payment validation rules engine');
  PERFORM pg_temp.seed_dependency(p_rtp, 'PCI-DSS scope review and PAN tokenization',               'Payment validation rules engine');
  PERFORM pg_temp.seed_dependency(p_rtp, 'AML transaction screening (OFAC / UN / EU consolidated)', 'Payment validation rules engine');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Real-time fraud signal feed integration',                 'AML transaction screening (OFAC / UN / EU consolidated)');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Settlement reconciliation batch (intraday + EOD)',        'Multi-currency ledger posting service');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Operator NOC dashboard for live payment flow',            'End-to-end payment status webhook fan-out');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Disaster-recovery runbook + chaos drill',                 'Settlement reconciliation batch (intraday + EOD)');
  PERFORM pg_temp.seed_dependency(p_rtp, 'SOC 2 Type II evidence collection',                       'PCI-DSS scope review and PAN tokenization');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Performance test: 5,000 TPS sustained, p99 < 2s',         'Operator NOC dashboard for live payment flow');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Hosted-customer onboarding playbook',                     'SOC 2 Type II evidence collection');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Production cutover + dual-run window',                    'Performance test: 5,000 TPS sustained, p99 < 2s');
  PERFORM pg_temp.seed_dependency(p_rtp, 'Post-launch optimisation + KPI review',                   'Production cutover + dual-run window');

  -- ---- Project 2: Cross-Border FX Settlement Engine (roots: rate provider + ISO 4217) --
  PERFORM pg_temp.seed_dependency(p_fx, 'Currency pair coverage matrix (G10 + EM)',                  'FX rate provider integration (Refinitiv + Bloomberg)');
  PERFORM pg_temp.seed_dependency(p_fx, 'CLS settlement member onboarding',                          'Currency pair coverage matrix (G10 + EM)');
  PERFORM pg_temp.seed_dependency(p_fx, 'Nostro account reconciliation service',                     'CLS settlement member onboarding');
  PERFORM pg_temp.seed_dependency(p_fx, 'T+0 / T+1 / T+2 settlement window engine',                  'CLS settlement member onboarding');
  PERFORM pg_temp.seed_dependency(p_fx, 'Pre-trade FX quote API',                                    'Currency pair coverage matrix (G10 + EM)');
  PERFORM pg_temp.seed_dependency(p_fx, 'Hedge ticket auto-generation for treasury',                 'Pre-trade FX quote API');
  PERFORM pg_temp.seed_dependency(p_fx, 'Multi-leg netting calculator',                              'Nostro account reconciliation service');
  PERFORM pg_temp.seed_dependency(p_fx, 'Sanctions screening on settlement counterparty',            'ISO 4217 currency reference data service');
  PERFORM pg_temp.seed_dependency(p_fx, 'Settlement risk dashboard (Herstatt exposure)',             'T+0 / T+1 / T+2 settlement window engine');
  PERFORM pg_temp.seed_dependency(p_fx, 'SWIFT MT300 / MT320 confirmation generator',                'T+0 / T+1 / T+2 settlement window engine');
  PERFORM pg_temp.seed_dependency(p_fx, 'Regulatory reporting: EMIR + Dodd-Frank trade repository',  'SWIFT MT300 / MT320 confirmation generator');
  PERFORM pg_temp.seed_dependency(p_fx, 'FX rate slippage analytics',                                'Pre-trade FX quote API');
  PERFORM pg_temp.seed_dependency(p_fx, 'Disaster scenario: CLS outage failover',                    'T+0 / T+1 / T+2 settlement window engine');
  PERFORM pg_temp.seed_dependency(p_fx, 'UAT with treasury desks (London + Singapore + New York)',   'Settlement risk dashboard (Herstatt exposure)');
  PERFORM pg_temp.seed_dependency(p_fx, 'Production rollout (cohort by region)',                     'UAT with treasury desks (London + Singapore + New York)');
  PERFORM pg_temp.seed_dependency(p_fx, 'Post-go-live performance review',                           'Production rollout (cohort by region)');

  -- ---- Project 3: Mobile Banking Super-App (root: Design system) --
  PERFORM pg_temp.seed_dependency(p_app, 'Biometric auth + step-up MFA (FIDO2 / WebAuthn)',                     'Design system + localisation framework');
  PERFORM pg_temp.seed_dependency(p_app, 'Account aggregation (Plaid / Tink / Yodlee)',                         'Biometric auth + step-up MFA (FIDO2 / WebAuthn)');
  PERFORM pg_temp.seed_dependency(p_app, 'Card management (freeze / unfreeze, PIN reset, virtual cards)',       'Account aggregation (Plaid / Tink / Yodlee)');
  PERFORM pg_temp.seed_dependency(p_app, 'P2P transfer (Zelle / Pay-by-Bank / PIX / UPI)',                      'Account aggregation (Plaid / Tink / Yodlee)');
  PERFORM pg_temp.seed_dependency(p_app, 'International wire transfer wizard',                                  'P2P transfer (Zelle / Pay-by-Bank / PIX / UPI)');
  PERFORM pg_temp.seed_dependency(p_app, 'Bill pay + e-invoice ingestion',                                      'Account aggregation (Plaid / Tink / Yodlee)');
  PERFORM pg_temp.seed_dependency(p_app, 'FX currency conversion in-app',                                       'International wire transfer wizard');
  PERFORM pg_temp.seed_dependency(p_app, 'Investments tab: brokerage + ETF marketplace',                        'Account aggregation (Plaid / Tink / Yodlee)');
  PERFORM pg_temp.seed_dependency(p_app, 'Robo-advisor portfolio recommendations',                              'Investments tab: brokerage + ETF marketplace');
  PERFORM pg_temp.seed_dependency(p_app, 'Push notifications + secure messaging center',                        'Design system + localisation framework');
  PERFORM pg_temp.seed_dependency(p_app, 'Accessibility audit (WCAG 2.2 AA)',                                   'Design system + localisation framework');
  PERFORM pg_temp.seed_dependency(p_app, 'Regional regulatory variants (Reg E, PSD2/SCA, MAS, UPI, PIX)',       'Card management (freeze / unfreeze, PIN reset, virtual cards)');
  PERFORM pg_temp.seed_dependency(p_app, 'App Store + Play Store release pipelines',                            'Design system + localisation framework');
  PERFORM pg_temp.seed_dependency(p_app, 'In-app KYC re-verification flow',                                     'Biometric auth + step-up MFA (FIDO2 / WebAuthn)');
  PERFORM pg_temp.seed_dependency(p_app, 'Privacy: GDPR / CCPA / LGPD data export and delete',                  'In-app KYC re-verification flow');
  PERFORM pg_temp.seed_dependency(p_app, 'Performance budget enforcement (cold start < 2s)',                    'App Store + Play Store release pipelines');
  PERFORM pg_temp.seed_dependency(p_app, 'Phased rollout: US → UK → EU → APAC',                                 'Performance budget enforcement (cold start < 2s)');

  -- ---- Project 4: PSD2 / Open Banking refresh (root: gap assessment) --
  PERFORM pg_temp.seed_dependency(p_psd2, 'eIDAS QWAC / QSealC certificate rotation',             'PSD2 RTS-SCA gap assessment');
  PERFORM pg_temp.seed_dependency(p_psd2, 'Strong Customer Authentication (SCA) decoupled flow', 'eIDAS QWAC / QSealC certificate rotation');
  PERFORM pg_temp.seed_dependency(p_psd2, 'Account Information Service (AIS) endpoints v3',      'Strong Customer Authentication (SCA) decoupled flow');
  PERFORM pg_temp.seed_dependency(p_psd2, 'Payment Initiation Service (PIS) endpoints v3',       'Strong Customer Authentication (SCA) decoupled flow');
  PERFORM pg_temp.seed_dependency(p_psd2, 'Confirmation of Funds (CoF) endpoint',                 'Account Information Service (AIS) endpoints v3');
  PERFORM pg_temp.seed_dependency(p_psd2, 'Berlin Group NextGenPSD2 compatibility tests',         'Payment Initiation Service (PIS) endpoints v3');
  PERFORM pg_temp.seed_dependency(p_psd2, 'UK OBIE conformance suite re-certification',           'Payment Initiation Service (PIS) endpoints v3');
  PERFORM pg_temp.seed_dependency(p_psd2, 'TPP onboarding portal updates',                        'Berlin Group NextGenPSD2 compatibility tests');
  PERFORM pg_temp.seed_dependency(p_psd2, 'Production rollout + dual-version window',             'UK OBIE conformance suite re-certification');
  PERFORM pg_temp.seed_dependency(p_psd2, 'EBA reporting confirmation',                           'Production rollout + dual-version window');

  -- ---- Project 5: Fraud Detection ML Upgrade (root: feature store audit) --
  PERFORM pg_temp.seed_dependency(p_fraud, 'Historical transaction data lake refresh',           'Feature store audit + lineage documentation');
  PERFORM pg_temp.seed_dependency(p_fraud, 'Baseline model (gradient-boosted) retraining',        'Historical transaction data lake refresh');
  PERFORM pg_temp.seed_dependency(p_fraud, 'Sequence model (LSTM) for card-present fraud',        'Baseline model (gradient-boosted) retraining');
  PERFORM pg_temp.seed_dependency(p_fraud, 'Graph features for mule-account detection',           'Historical transaction data lake refresh');
  PERFORM pg_temp.seed_dependency(p_fraud, 'AML / SAR rule layer integration (FinCEN, FCA, EBA)', 'Baseline model (gradient-boosted) retraining');
  PERFORM pg_temp.seed_dependency(p_fraud, 'Real-time scoring service (< 50ms p99)',              'Sequence model (LSTM) for card-present fraud');
  PERFORM pg_temp.seed_dependency(p_fraud, 'Model explainability dashboard (SHAP)',               'Real-time scoring service (< 50ms p99)');
  PERFORM pg_temp.seed_dependency(p_fraud, 'A/B test framework: champion vs. challenger',         'Real-time scoring service (< 50ms p99)');
  PERFORM pg_temp.seed_dependency(p_fraud, 'Cross-border transaction risk scoring',               'Graph features for mule-account detection');
  PERFORM pg_temp.seed_dependency(p_fraud, 'Model risk governance (SR 11-7) sign-off pack',       'Model explainability dashboard (SHAP)');
  PERFORM pg_temp.seed_dependency(p_fraud, 'Production deployment + shadow mode',                 'A/B test framework: champion vs. challenger');

END $$;

