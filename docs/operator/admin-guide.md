# IT Admin Guide

**Audience:** IT Administrator  
**System:** Performance Management System (PMS)  
**Last updated:** 2026-04-20

---

## Overview

As IT Admin you have the `it_admin` role, which grants access to:
- User invite and account management
- Impersonation sessions (for support)
- Account unlock (lockout bypass)
- System health checks
- Audit log verification
- Access review management

You do **not** have direct HRA cycle-management powers (opening KRA windows, bulk mid-year, PMS finalization). Those belong to the `hra` role.

---

## 1. User Invites

### What it does

Creates a time-limited invite link for a new staff member. On acceptance, the user creates a password and their account is linked to an optional staff record.

### When to use

- New joiner onboarding (HR provides the staff ID from HRMS)
- Re-invite if previous invite expired (7-day TTL)
- Role provisioning for HR admins or managers

### How to use

**API:**
```
POST /api/v1/onboarding/invite
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "email": "new.staff@company.com",
  "staffId": "<uuid from staff table>",
  "roles": ["staff"],
  "orgId": "<org uuid>"
}
```

Roles available: `staff`, `appraiser`, `next_level`, `department_head`, `hr_manager`, `hra`, `it_admin`.

**Response:**
```json
{ "ok": true, "inviteToken": "...", "link": "https://your-app/accept-invite?token=..." }
```

The link is emailed to the user automatically. You can also copy it manually if email fails.

### Logs/audit events

Event `invite_created` is written to `audit_log` with `actor_id = your user id`, `target_type = "invite"`, `target_id = invite token hash`.

### Troubleshooting

| Issue | Fix |
|-------|-----|
| User says invite expired | Re-invite: POST /api/v1/onboarding/invite again |
| Invite sent to wrong email | Re-invite with correct email; old token auto-expires |
| User not linked to staff record | Provide `staffId` in invite body; or link manually in DB if user already exists |

---

## 2. Impersonation

### What it does

Allows IT Admin to log in as another user to reproduce and diagnose issues. Sessions are time-limited and fully audited.

### When to use

- A staff member reports a bug you cannot reproduce with your own account
- HR asks you to verify what a specific user sees
- Debugging role/scope issues

### How to use

**Start impersonation:**
```
POST /api/v1/admin/impersonation/start
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "targetUserId": "<user uuid>",
  "reason": "Investigating KRA submission bug reported by staff EMP001",
  "durationMin": 30
}
```

Response: `{ "ok": true, "sessionId": "...", "expiresAt": "..." }`

The impersonation session is scoped to `durationMin` minutes (max 60). After it expires, the session automatically becomes invalid.

**Stop impersonation early:**
```
POST /api/v1/admin/impersonation/stop
Authorization: Bearer <your-token>
Content-Type: application/json

{ "reason": "Issue reproduced and documented" }
```

### Logs/audit events

`impersonation_started` and `impersonation_ended` events written to `audit_log` with full detail. These are reviewed in quarterly access reviews.

### Constraints

- You can only impersonate non-admin users (cannot impersonate another `it_admin` or `hra`).
- Maximum session: 60 minutes.
- You cannot modify data while impersonating; read-only access is enforced for impersonation sessions (check the impersonation middleware for the current list of restricted actions).

### Troubleshooting

| Issue | Fix |
|-------|-----|
| `403 forbidden — it_admin required` | Your token does not have `it_admin` role; check your staff_role row |
| Session expired before you finished | Stop and restart: POST /stop then POST /start with a longer duration |
| Target user is also an admin | Not supported by design; contact tech lead for alternatives |

---

## 3. Account Unlock

### What it does

Unlocks a user account that has been locked due to excessive failed login attempts. The lockout threshold is 10 failed attempts within 15 minutes.

### When to use

- A staff member is locked out and needs immediate access
- Automated lockout triggered by a system issue (e.g., a client sending repeated bad requests)

### How to use

```
POST /api/v1/admin/auth/unlock
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "userId": "<user uuid>",
  "reason": "Staff locked out; confirmed legitimate user via Teams call"
}
```

Response: `{ "ok": true }`

HRA role can also unlock accounts (same endpoint).

### Logs/audit events

`account_unlocked` event written to `audit_log` with your user ID, the target user ID, and the reason.

### Troubleshooting

| Issue | Fix |
|-------|-----|
| `user not found` | Verify userId is a valid UUID from the `user` table |
| Account still locked after unlock | Check `lockout_event` table; if there is a second lock, unlock again and investigate the source of failed logins |
| Multiple lockouts in a day | Possible credential stuffing; escalate to tech lead |

---

## 4. Access Reviews

### What it does

Periodic reviews of all user roles and access rights to detect dormant accounts, over-privileged users, and terminated staff who still have access.

### When to use

- Monthly or quarterly (schedule recommended: quarterly minimum)
- After a staff termination
- Before any audit

### How to use

**List access review cycles:**
```
GET /api/v1/admin/access-review/cycles
Authorization: Bearer <your-token>
```

**View items in a review cycle:**
```
GET /api/v1/admin/access-review/cycles/:id/items?decision=pending&limit=50
Authorization: Bearer <your-token>
```

**Apply a decision:**
```
POST /api/v1/admin/access-review/cycles/:id/items/:itemId/decide
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "decision": "retain" | "revoke" | "escalate",
  "reason": "Active staff; role correct"
}
```

### What to look for

- Users with `it_admin` or `hra` who have left the company
- Staff with `appraiser` role whose direct report list is empty (possibly role is stale)
- Accounts not logged in for > 90 days
- Users with multiple roles that seem inconsistent (e.g., `staff` + `it_admin`)

### Logs/audit events

All decisions written to `access_review_item` with `decided_by_user_id` and timestamp.

---

## 5. Audit Log Verification

### What it does

Verifies the cryptographic hash chain of the `audit_log` table. Each row's hash includes the previous row's hash, forming a tamper-evident chain. Verification detects any post-write modifications.

### When to use

- Monthly health check
- Before and after any DB restore (including staging clones)
- During an incident investigation
- As part of access review

### How to use

```
GET /api/v1/admin/audit/verify?from=2026-01-01&to=2026-12-31
Authorization: Bearer <your-token>
```

**Success response:** `{ "ok": true }`

**Failure response:**
```json
{
  "ok": false,
  "firstFailureAt": "<audit_log id>",
  "reason": "hash mismatch at audit_log id ..."
}
```

### What to do if verification fails

1. Do not panic; note the `firstFailureAt` ID and time range.
2. Retrieve the row: `SELECT * FROM audit_log WHERE id = <id>`.
3. Check if the row was manually edited (compare `prev_hash` with the previous row's `hash`).
4. Escalate to tech lead immediately if tampering is suspected.
5. Document in `infra/runbooks/post-mortems/` with full timeline.

---

## 6. System Health Dashboard

### Endpoints to check

| Check | Endpoint | Expected |
|-------|----------|---------|
| Shallow health | `GET /healthz` | `{"status":"ok"}` |
| Deep health | `GET /api/v1/healthz/deep` (with `x-health-token` header) | `{"db":"ok","r2":"ok"}` |
| Audit chain | `GET /api/v1/admin/audit/verify` | `{"ok":true}` |

### Railway metrics

In the Railway dashboard for the production environment:
- **API service → Metrics:** Check HTTP error rate (should be < 1%) and response time (p95 < 500 ms)
- **Worker service → Logs:** Filter by `[job]` to see job processing; `[error]` for failures
- **Postgres service → Metrics:** Watch CPU and memory; disk usage should not exceed 80%

### pg-boss job queue

For notification and PDF job health:
```sql
SELECT name, state, count(*)
FROM pgboss.job
GROUP BY name, state
ORDER BY name, state;
```

Any jobs in `failed` state need investigation. See the incident-response runbook for details.

---

## 7. Password Reset

Staff who forget their password use the self-service reset flow:

1. Staff visits `/reset-password` on the app.
2. They enter their email address.
3. A reset token is emailed to them (handled by the `onboarding/password-reset` module).
4. They click the link and set a new password.

**IT Admin involvement:** None required unless the user's email is wrong or unreachable. In that case, update the email in the `user` table and re-invite if needed. Note: direct DB edits to `user.email` will break the audit chain for that record — document the change in a post-mortem note.

---

## 8. Terminated Staff

When a staff member leaves:

1. HR notifies IT Admin.
2. IT Admin deletes (or disables) their `session` rows to force logout:
   ```sql
   DELETE FROM "session" WHERE user_id = '<user uuid>';
   ```
3. IT Admin marks the staff record as terminated (if not already done via HR import):
   ```sql
   UPDATE staff SET terminated_at = NOW() WHERE id = '<staff uuid>';
   ```
4. Access review: run a review cycle or manually add a `revoke` decision for the user's access review item.
5. The user's data is retained per the 7-year retention policy. After 7 years, the `user` row is deleted (staff row is anonymized, not deleted).

Audit event `staff_terminated` should already be logged via the HR import batch (if using the bulk import flow). Verify it exists.
