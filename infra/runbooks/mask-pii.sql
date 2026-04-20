-- =============================================================================
-- PII MASKING SCRIPT
-- Target:  staging database only (NEVER run on production)
-- Effect:  replaces all human-identifiable fields with deterministic placeholders
--          derived from employee_no so data remains relatable across tables.
-- Run:     psql "$STAGING_DATABASE_URL" -f infra/runbooks/mask-pii.sql
-- =============================================================================

BEGIN;

-- ── 1. Mask user table (better-auth managed) ──────────────────────────────────
--  Name  → full name replaced by "Staff <employeeNo>" via join through staff
--  Email → "<employeeNo>@example.test"
UPDATE "user" u
SET
  name  = 'Staff ' || s.employee_no,
  email = lower(s.employee_no) || '@example.test',
  image = NULL
FROM staff s
WHERE s.user_id = u.id;

-- Users without a linked staff record (e.g. service accounts): generic mask
UPDATE "user"
SET
  name  = 'User-' || substr(id::text, 1, 8),
  email = 'user-' || substr(id::text, 1, 8) || '@example.test',
  image = NULL
WHERE id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL);

-- ── 2. Mask staff table ───────────────────────────────────────────────────────
UPDATE staff
SET name = 'Staff ' || employee_no;
-- employee_no, designation, hire_date, manager hierarchy, org/dept/grade links: preserved

-- ── 3. Wipe free-text KRA fields ─────────────────────────────────────────────
UPDATE kra
SET
  description   = '[REDACTED]',
  measurement   = '[REDACTED]',
  target        = '[REDACTED]',
  rubric_1_to_5 = '{"1":"[REDACTED]","2":"[REDACTED]","3":"[REDACTED]","4":"[REDACTED]","5":"[REDACTED]"}'::jsonb;

-- ── 4. Wipe KRA progress update free-text ────────────────────────────────────
UPDATE kra_progress_update
SET result_achieved = '[REDACTED]';

-- ── 5. Wipe PMS comment bodies ────────────────────────────────────────────────
UPDATE pms_comment
SET body = '[REDACTED]';

-- ── 6. Wipe staff contribution achievements ───────────────────────────────────
UPDATE staff_contribution
SET achievement = '[REDACTED]';

-- ── 7. Wipe PMS KRA rating comments and result_achieved ───────────────────────
UPDATE pms_kra_rating
SET
  result_achieved = '[REDACTED]',
  comment         = '[REDACTED]';

-- ── 8. Wipe behavioural rating comments ──────────────────────────────────────
UPDATE behavioural_rating
SET comment = '[REDACTED]';

-- ── 9. Wipe career development free text ─────────────────────────────────────
UPDATE career_development
SET
  read_in  = '[REDACTED]',
  comments = '[REDACTED]';

-- ── 10. Wipe personal growth free text ───────────────────────────────────────
UPDATE personal_growth
SET
  training_needs = '[REDACTED]',
  comments       = '[REDACTED]';

-- ── 11. Wipe mid-year checkpoint summary ─────────────────────────────────────
UPDATE mid_year_checkpoint
SET summary = '[REDACTED]';

-- ── 12. Wipe audit log detail payloads (preserve chain metadata) ──────────────
--  We keep actor_id, action, target_type, target_id so the chain can still be
--  verified; we blank free-text detail fields.
UPDATE audit_log
SET detail = '{"masked":true}'::jsonb
WHERE detail IS NOT NULL;

-- ── 13. Wipe notification payload bodies ─────────────────────────────────────
UPDATE notification
SET payload = jsonb_set(
  payload,
  '{body}',
  '"[REDACTED]"'::jsonb,
  false
)
WHERE payload ? 'body';

-- ── 14. Wipe account password hashes (staging uses only SSO / magic-link) ────
UPDATE account
SET password = NULL
WHERE password IS NOT NULL;

-- ── 15. Truncate live session and verification tables ─────────────────────────
TRUNCATE TABLE "session" CASCADE;
TRUNCATE TABLE "verification" CASCADE;

-- ── 16. Remove two_factor secrets ────────────────────────────────────────────
DELETE FROM two_factor;

COMMIT;

-- =============================================================================
-- SPOT-CHECK QUERIES (run manually after script completes)
-- All should return 0 rows.
-- =============================================================================
-- SELECT id, email FROM "user" WHERE email NOT LIKE '%@example.test' LIMIT 5;
-- SELECT id, name  FROM staff   WHERE name  NOT LIKE 'Staff %' LIMIT 5;
-- SELECT id, body  FROM pms_comment WHERE body != '[REDACTED]' LIMIT 5;
-- SELECT id, achievement FROM staff_contribution WHERE achievement != '[REDACTED]' LIMIT 5;
-- SELECT id, description FROM kra WHERE description != '[REDACTED]' LIMIT 5;
