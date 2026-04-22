# Staging Clone Runbook (T41)

**Owner:** IT Admin  
**Frequency:** Monthly during December 2026 (and before each rehearsal)  
**Purpose:** Refresh staging from production with PII masked so rehearsals use realistic data without exposing real staff information.

---

## 1. Overview

Production data is cloned into the staging Railway environment, then a masking SQL script runs in-place to replace all personally identifiable information. No PII leaves production in clear text. The staging DB after masking is safe for the engineering team and HR testers to use freely.

---

## 2. Prerequisites

- Railway CLI installed (`npm install -g @railway/cli`) and authenticated (`railway login`).
- You have **Admin** access to the Railway project.
- The staging service has a Postgres database provisioned (separate from prod).
- `DATABASE_URL` for each environment is noted; do **not** mix them up.
- At least 30 minutes of maintenance window (staging only; prod stays online).

---

## 3. Step-by-Step Procedure

### Step 1 — Snapshot production DB

1. Open the Railway dashboard → select the **Production** environment.
2. Navigate to the **Postgres** service → **Backups** tab.
3. Click **"Create Snapshot"** and label it `prod-YYYY-MM-DD-pre-staging-clone`.
4. Wait for the snapshot status to show **"Ready"** (usually 2–5 minutes for a small DB).
5. Copy the **snapshot ID** — you will need it in Step 3.

### Step 2 — Pause staging worker (prevent job noise during clone)

```bash
# In the Railway dashboard: staging environment → worker service → Pause
# Or via CLI:
railway environment use staging
railway service pause worker
```

### Step 3 — Restore snapshot to staging DB

> **Warning:** This overwrites the staging database completely. Confirm the target is staging, not production.

1. In the Railway dashboard → **Staging** environment → **Postgres** service → **Backups** tab.
2. Click **"Restore from snapshot"** → select the snapshot created in Step 1.
3. Confirm the restore. Railway will briefly restart the staging DB service.
4. Wait for status **"Active"** before proceeding.

Alternatively via Railway CLI (if the `railway db restore` command is available in your CLI version):
```bash
railway environment use staging
railway db restore --snapshot-id <SNAPSHOT_ID> --service postgres
```

### Step 4 — Run the PII masking script

Connect to the staging database via `psql` (get the connection string from the Railway dashboard → staging Postgres → **Connect** tab):

```bash
psql "$STAGING_DATABASE_URL" -f infra/runbooks/mask-pii.sql
```

The masking SQL is embedded below in Section 4. Run it in full before opening staging to any tester.

### Step 5 — Restart staging services

```bash
railway environment use staging
railway service restart api
railway service restart worker
```

### Step 6 — Verify (see Section 5)

Run the spot-checks documented in Section 5 before handing off to HR testers.

### Step 7 — Resume staging worker

```bash
railway service resume worker
```

---

## 4. PII Masking SQL Script (`infra/runbooks/mask-pii.sql`)

Save the block below as `infra/runbooks/mask-pii.sql` and run it against the staging DB. It is also reproduced here for the runbook reader.

```sql
-- =============================================================================
-- PII MASKING SCRIPT
-- Target:  staging database only (NEVER run on production)
-- Effect:  replaces all human-identifiable fields with deterministic placeholders
--          derived from employee_no so data remains relatable across tables.
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
  description = '[REDACTED]',
  measurement = '[REDACTED]',
  target      = '[REDACTED]',
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

-- ── 12. Wipe audit log details (keep structural fields, blank payload text) ───
--  We keep actor_id, action, target_type, target_id so the chain can still be
--  verified; we blank any free-text detail fields.
UPDATE audit_log
SET detail = '{"masked":true}'::jsonb
WHERE detail IS NOT NULL;

-- ── 13. Wipe notification bodies ─────────────────────────────────────────────
UPDATE notification
SET payload = jsonb_set(
  payload,
  '{body}',
  '"[REDACTED]"'::jsonb,
  false
)
WHERE payload ? 'body';

-- ── 14. Wipe account password hashes (staging uses only SSO / magic-link) ────
--  This prevents any prod password from being usable in staging.
UPDATE account
SET password = NULL
WHERE password IS NOT NULL;

-- ── 15. Truncate session and verification tables ──────────────────────────────
TRUNCATE TABLE "session" CASCADE;
TRUNCATE TABLE "verification" CASCADE;

-- ── 16. Truncate two_factor secrets ──────────────────────────────────────────
DELETE FROM two_factor;

COMMIT;

-- Post-masking check (run these SELECT statements manually to spot-check)
-- SELECT email FROM "user" WHERE email NOT LIKE '%@example.test' LIMIT 5;
-- SELECT name  FROM staff   WHERE name  NOT LIKE 'Staff %' LIMIT 5;
-- SELECT body  FROM pms_comment WHERE body != '[REDACTED]' LIMIT 5;
```

---

## 5. Verification After Masking

Run each check against **staging**. All must return 0 rows.

```sql
-- 5.1  No real email addresses remain
SELECT id, email FROM "user"
WHERE email NOT LIKE '%@example.test'
LIMIT 5;

-- 5.2  No unmasked staff names
SELECT id, name FROM staff
WHERE name NOT LIKE 'Staff %'
LIMIT 5;

-- 5.3  No raw PMS comment bodies
SELECT id, body FROM pms_comment
WHERE body != '[REDACTED]'
LIMIT 5;

-- 5.4  No achievement text
SELECT id, achievement FROM staff_contribution
WHERE achievement != '[REDACTED]'
LIMIT 5;

-- 5.5  Row count sanity — compare with prod counts (recorded before clone)
SELECT
  (SELECT count(*) FROM staff)             AS staff_count,
  (SELECT count(*) FROM "user")            AS user_count,
  (SELECT count(*) FROM performance_cycle) AS cycle_count,
  (SELECT count(*) FROM kra)               AS kra_count,
  (SELECT count(*) FROM pms_assessment)    AS pms_count;
```

Record actual counts and compare against the prod snapshot counts noted before the clone. They must match (within ±0 for deterministic tables; ±0 for all rows that existed at snapshot time).

---

## 6. Rollback / Abort

If masking fails partway through, the SQL is wrapped in a transaction — it will have rolled back automatically. Restore the staging DB from the same snapshot and try again. Do **not** allow partial-mask staging to be used by testers.

---

## 7. Schedule (December 2026)

| Date | Action |
|------|--------|
| 2026-11-30 | Rehearsal #0 — dry run of this script on an empty staging DB |
| 2026-12-01 | First production clone → staging for Rehearsal #1 |
| 2026-12-15 | Second clone refresh before Rehearsal #2 |
| 2027-01-03 | Third clone refresh before Rehearsal #3 |

---

## 8. Contacts

| Role | Person | Contact |
|------|--------|---------|
| IT Admin (script executor) | IT team | it@yadiski.my |
| HRA sign-off | HR Admin | hr-admin@yadiski.my |
| Railway support | support.railway.app | Ticket via dashboard |
