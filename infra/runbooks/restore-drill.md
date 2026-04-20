# Restore Drill Runbook

## 1. Purpose

A restore drill confirms two things:

1. **Railway's snapshot is actually restorable** — a backup that has never been tested is not a backup.
2. **The audit chain survives the restore** — `verifyChain` must pass on the restored database, proving that the cryptographic audit log is intact and has not been tampered with during the backup/restore cycle.

Without periodic drills, the first time you discover a backup is corrupt or incomplete will be during an actual incident — the worst possible moment.

---

## 2. Automated Path

### How the cron job works

The weekly restore drill is implemented as a pg-boss cron job registered in `apps/api/src/jobs/weekly-restore-drill.ts`.

- **Schedule**: Every Monday at **06:00 UTC**.
- **Activation**: Only runs when `ENABLE_RESTORE_DRILL=true` is set in the environment. Production deployments must **not** set this variable — the script is intended for staging only.
- **What it does**: Calls `verifyRestoredState(thirtyDaysAgo, today)` from `apps/api/src/scripts/restore-drill.ts`, which reads the audit chain for the last 30 days and returns pass/fail.
- **Read-only**: The script never mutates the database. Exit code 0 = pass, 1 = fail.

### Where logs go

- Standard output (`console.log`) — captured by Railway's deployment log stream.
- View logs: Railway dashboard → your service → **Logs** tab → filter by `[weekly-restore-drill]`.

### How alerts fire

If the job fails **and** `VERIFY_ALERT_EMAILS` is set (comma-separated list), an email is sent via Resend to each address with the failure reason. Requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to be set in the staging environment.

### Restore drill log table (optional)

For a durable audit trail of drill results, create a simple table:

```sql
create table if not exists restore_drill_log (
  id         uuid primary key default gen_random_uuid(),
  drilled_at timestamptz not null default now(),
  from_date  date not null,
  to_date    date not null,
  ok         boolean not null,
  detail     text
);
```

Insert a row from the drill job after each run. This is not yet implemented — the current version logs to stdout only.

---

## 3. Manual Path

Use this procedure for quarterly verification or whenever you need to validate a specific snapshot.

### Prerequisites

- Access to the Railway dashboard (Admin or Viewer role).
- A **staging** Railway environment with its own PostgreSQL instance.
- The `bun` runtime installed in your local shell or the staging shell.
- `DATABASE_URL` pointing at the **staging** database.

### Step-by-step

**Step 1 — Restore snapshot to staging DB**

1. Open Railway dashboard → your project → **PostgreSQL** service.
2. Click **Backups** tab.
3. Identify the snapshot to test (use the latest, or the one from the date you want to verify).
4. Click **Restore** → select your **staging** PostgreSQL instance as the target.
5. Confirm. Railway will replace the staging database contents with the snapshot. This takes 2–15 minutes depending on database size.

> Warning: This overwrites all data in the staging database. Ensure the staging DB is not shared with active users.

**Step 2 — Point the staging app at the restored DB**

Railway automatically updates `DATABASE_URL` for the staging environment after the restore. If you are running the drill script locally, export the staging connection string:

```bash
export DATABASE_URL="postgresql://..."   # staging credentials from Railway
export BETTER_AUTH_SECRET="..."
export BETTER_AUTH_URL="http://localhost:3000"
export NODE_ENV="development"
export API_PORT="3000"
export WEB_ORIGIN="http://localhost:5173"
```

**Step 3 — Run the drill script**

```bash
bun apps/api/src/scripts/restore-drill.ts
```

Expected output on success:

```
[restore-drill] Verifying audit chain from 2026-03-21 to 2026-04-20 …
[restore-drill] PASS — Audit chain intact from 2026-03-21 to 2026-04-20
```

Expected output on failure:

```
[restore-drill] Verifying audit chain from 2026-03-21 to 2026-04-20 …
[restore-drill] FAIL — Audit chain broken at id=12345 (range 2026-03-21→2026-04-20)
```

Exit code 0 = pass, 1 = fail.

**Step 4 — Document the result**

Record the outcome in:
- The `restore_drill_log` table (if implemented), or
- A ticket in the team's incident tracker tagged `restore-drill`, noting:
  - Date drilled
  - Snapshot date tested
  - Pass/fail
  - Any anomalies

---

## 4. Failure Response

### Who gets paged

If `VERIFY_ALERT_EMAILS` is set, everyone on that list receives an email. Typically this should include the IT Admin and the HRA lead.

If email is not configured, check Railway logs manually and escalate via your team's on-call rotation.

### Investigation checklist

- [ ] Identify the first broken audit log row (the `failedId` in the error message).
- [ ] Compare that row's `prev_hash` against the `hash` of the preceding row in the restored database.
- [ ] Check whether the row was present in production before the snapshot was taken (compare row `id` vs. the snapshot timestamp).
- [ ] Determine whether tampering occurred in production (pre-snapshot), during the snapshot itself, or during the restore process.
- [ ] If tampering is suspected in production, initiate the incident-response procedure: `infra/runbooks/incident-response.md`.

### Escalation

| Severity | Trigger | Action |
|----------|---------|--------|
| Low | Single row mismatch in a very old range | Investigate; re-run drill. May be a known driver normalization issue. |
| Medium | Multiple rows or recent range | Notify IT Admin + HRA. Open incident ticket. |
| High | Evidence of tampering in production DB | Escalate to CISO/DPO. Freeze production writes. Follow incident-response runbook. |

---

## 5. Audit Cadence

| Frequency | Type | Owner |
|-----------|------|-------|
| Weekly (automated) | Chain verify only (no restore) | pg-boss cron (staging env) |
| Quarterly (manual) | Full restore + chain verify | IT Admin |
| Ad-hoc | After any major incident or schema migration | IT Admin + HRA |

The last manual drill date should be recorded in the `restore_drill_log` table or in the project's quarterly review document. The quarterly manual drill is also documented in [`daily-snapshot.md`](./daily-snapshot.md).
