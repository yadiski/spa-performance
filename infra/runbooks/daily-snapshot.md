# Daily Snapshot Runbook

## Purpose

Railway automatically creates daily PostgreSQL snapshots for all projects running on the Pro plan and above. This runbook documents the snapshot configuration, how to access snapshots, and supplementary backup options.

---

## Railway Automatic Daily Snapshots

### Retention and Size

| Plan         | Retention | Max snapshot size |
|--------------|-----------|-------------------|
| Hobby        | 1 day     | 1 GB              |
| Pro          | 7 days    | Unlimited         |
| Enterprise   | Configurable (up to 30 days) | Unlimited |

> **Action required**: Confirm your Railway plan provides at least 7-day retention. If the project is on the Hobby plan, upgrade to Pro or add supplementary backups (see below).

### Snapshot schedule

Railway creates snapshots automatically at approximately **02:00 UTC** each day. The exact window may drift by ±1 hour depending on platform load. No user action is needed to trigger snapshots.

---

## Viewing Snapshots in the Railway Dashboard

1. Open [railway.app](https://railway.app) and navigate to your project.
2. Click the **PostgreSQL** service.
3. Select the **Backups** tab (on the service detail page).
4. A list of available snapshots is shown, sorted by date (newest first). Each entry shows:
   - Snapshot date/time
   - Snapshot size
   - Status (`ready` / `in-progress` / `failed`)

---

## Quarterly Verification

Once per quarter, a designated team member (IT Admin or HRA) should:

1. Pick the most recent snapshot from the list.
2. Follow the restore-to-staging procedure documented in [`restore-drill.md`](./restore-drill.md).
3. Record the result (pass/fail, row counts, `verifyChain` output) in the restore drill log table or in the incident tracker.

This satisfies the quarterly manual verification requirement.

---

## Supplementary Nightly `pg_dump` to R2

<!-- TODO: If Railway's snapshot retention is insufficient (e.g., you need 30-day point-in-time retention or the plan only offers 1-day snapshots), implement a nightly pg_dump cron job that:
  1. Runs `pg_dump $DATABASE_URL --format=custom -f /tmp/dump.pgdump`
  2. Uploads the file to Cloudflare R2 using the existing S3-compatible client in
     `apps/api/src/storage/r2.ts` (bucket: $R2_BUCKET, key: `backups/YYYY-MM-DD.pgdump`)
  3. Prunes objects older than 30 days using R2 lifecycle rules or a scheduled script.
  4. Sends an alert via `apps/api/src/notifications/resend.ts` if the upload fails.

  Register as a pg-boss job (weekly or nightly) in `apps/api/src/jobs/` following the
  same pattern as `daily-audit-anchor.ts`.

  Env vars needed: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  (already in apps/api/src/env.ts as optional vars).
-->

---

## Related Runbooks

- [restore-drill.md](./restore-drill.md) — Weekly restore drill procedure (manual + automated).
