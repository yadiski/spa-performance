# Access Review Runbook

## Overview

The quarterly access review ensures that user roles and access rights are periodically verified by HR Administrators (HRA) and IT Admins. All decisions are audited.

---

## When the quarterly cron fires

The `compliance.access_review` pg-boss job runs on the **1st of January, April, July, and October at 00:00 UTC** (`cron: 0 0 1 1,4,7,10 *`).

On each run it:
1. Creates a new `access_review_cycle` row with `period_start`/`period_end` for the current quarter.
2. Snapshots every **active** (non-terminated) user: their roles, last session timestamp, and how many days their roles have been unchanged.
3. Inserts one `access_review_item` per user.
4. Transitions the cycle status from `pending` → `in_progress`.
5. Sends a notification email (via Resend) to every user with the `hra` or `it_admin` role.

---

## Email recipients and contents

**Recipients:** all users with role `hra` or `it_admin`.

**Subject:** `Quarterly access review — Q{N} {YYYY}`

**Body:**
- Number of users to review.
- A link to `/admin/access-review` in the web UI.

---

## HRA / IT Admin procedure

1. Log in and navigate to **Admin → Access Review**.
2. Select the current cycle from the dropdown (most-recent is pre-selected).
3. For each pending item, review:
   - **Name / Email** — confirm this is a known, current user.
   - **Roles** — confirm the roles are still appropriate.
   - **Last login** — flag users who have never logged in or have been inactive for an extended period.
   - **Days since change** — items highlighted amber have roles unchanged for more than 365 days; consider whether re-confirmation is needed.
4. Make a decision for each item:
   - **Approve** — access is confirmed appropriate; no action taken.
   - **Revoke** — see [Revocation side effects](#revocation-side-effects) below.
   - **Defer** — review delayed; item remains visible in the "deferred" filter. Deferred items count against cycle completion.
5. Once all items have a decision, the cycle status automatically transitions to `completed`.

---

## Revocation side effects

When a reviewer clicks **Revoke** (with a mandatory reason):

1. All `staff_role` rows for the target user are deleted immediately.
2. All active sessions (`session` table) for the user are deleted — the user is effectively logged out everywhere.
3. An `access_review.revoked` audit log entry is written, referencing the cycle, item, actor, and reason.

The user must contact HR or IT to regain access. HRA or IT Admin can re-invite the user via `POST /api/v1/onboarding/invite` or manually re-assign roles.

---

## SLA

The cycle must be **completed within 30 days** of generation. If items remain undecided after 30 days, IT Admin should follow up with HRA reviewers and escalate to the CTO or DPO if necessary.

---

## Manual trigger (emergency)

To generate an off-cycle review:

```bash
# From the API server environment, via pg-boss send:
bun -e "
import { boss } from './src/jobs/queue';
await boss.start();
await boss.send('compliance.access_review', {});
await boss.stop();
"
```

Or call `generateAccessReview(db)` directly from a REPL.

---

## Audit trail

Every access review action is written to `audit_log`:
- `access_review.generated` — when the cycle is created (actor: system).
- `access_review.approved` — when an item is approved.
- `access_review.revoked` — when an item is revoked.
- `access_review.deferred` — when an item is deferred.

Use the **Admin → Audit** page or query `audit_log` directly to verify the chain.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Cron did not fire | pg-boss schedule table; confirm worker is running and the `compliance.access_review` queue exists |
| No email received | Resend dashboard; confirm `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set in env |
| Cycle stuck in `in_progress` | All items must have a decision; query `access_review_item where decision is null` |
| User locked out after revoke | Expected — user must re-request access from HRA or IT Admin |
