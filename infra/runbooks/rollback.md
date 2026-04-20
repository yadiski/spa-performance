# Rollback Runbook

**Owner:** IT Admin / Tech Lead  
**Companion to:** `cutover-fy-2027.md`

---

## 1. When to Invoke a Rollback

Invoke a rollback when **any** of the following conditions are met and cannot be fixed within 30 minutes:

| Failure Mode | Definition | Who Can Trigger |
|---|---|---|
| **Data corruption** | Any row written to the DB is provably wrong (wrong FY, wrong staff link, wrong state transition logged) | Tech Lead (unilateral authority) |
| **Auth outage** | > 10% of users cannot log in due to session/lockout bugs, not user error | Tech Lead (unilateral authority) |
| **Mass notification spam** | Duplicate or erroneous emails sent to > 20 staff in a burst | HRA + IT Admin jointly |
| **Audit chain break** | `GET /api/v1/admin/audit/verify` returns `ok: false` on the live system | Tech Lead (unilateral authority) |
| **Sustained 5xx rate > 5%** | API error rate above 5% for more than 15 minutes with no fix in sight | HRA + IT Admin jointly |
| **PDF corruption** | Generated PDFs contain wrong data or fail hash verification | HRA + IT Admin jointly |

**Who approves:** HRA + IT Admin jointly for business-impact rollbacks; Tech Lead has unilateral authority for data-integrity and auth issues.

---

## 2. Rollback Procedure

### Step 1 — Declare rollback decision

Announce in `#fy2027-golive` Slack channel:
```
ROLLBACK DECLARED at HH:MM by [name]. Reason: [failure mode].
```

Notify Product Owner immediately via phone/direct message.

### Step 2 — Halt new traffic (optional, only if severe)

If the failure is actively worsening, put the API into maintenance mode first. In Railway:
1. Dashboard → Production → API service → **Environment Variables**
2. Set `MAINTENANCE_MODE=true` (if the app supports it; otherwise, temporarily stop the service)
3. This will return 503 to all clients while you restore.

### Step 3 — Restore database from snapshot

> **This is destructive. Confirm the snapshot ID before executing.**

1. Railway dashboard → Production → **Postgres** service → **Backups** tab.
2. Identify the snapshot labeled `prod-YYYY-MM-DD-pre-staging-clone` or the most recent pre-cutover snapshot.
3. Click **"Restore from snapshot"** and confirm.
4. Wait for DB status **"Active"**.

> Note: Any data written after the snapshot (new KRA drafts, comments, etc.) will be lost. This must be communicated to affected users.

### Step 4 — Deploy previous API version

```bash
# Find the last known-good commit SHA (stored in #fy2027-golive or the deploy log)
KNOWN_GOOD_SHA="<last-good-commit>"

railway environment use production
railway deploy --detach --commit $KNOWN_GOOD_SHA
```

Wait for deploy to complete and `/healthz` to return `{"status":"ok"}`.

### Step 5 — Verify audit chain on restored DB

```bash
curl -H "x-health-token: $HEALTH_CHECK_TOKEN" \
  https://your-domain/api/v1/healthz/deep
# Expected: {"db":"ok","r2":"ok"}

curl -H "Authorization: Bearer $HRA_TOKEN" \
  "https://your-domain/api/v1/admin/audit/verify?from=YYYY-MM-DD&to=YYYY-MM-DD"
# Expected: {"ok":true}
```

### Step 6 — Notify users

Send the rollback user notification (template below) from the HR admin email to all staff who received the KRA window open notification.

> **Subject: Temporary System Rollback — FY 2027 KRA Window**
>
> Dear [Name],
>
> Due to a technical issue identified shortly after launch, we have temporarily rolled back the FY 2027 system. Any data you entered in the past [N hours] may have been affected.
>
> We will communicate a new go-live date once the issue is resolved. We apologise for the inconvenience.
>
> For urgent queries, contact it@invenioptl.com or hr-admin@invenioptl.com.
>
> Regards,  
> HR Administration

### Step 7 — Remove maintenance mode

If step 2 was executed:
1. Railway dashboard → delete `MAINTENANCE_MODE` env var (or set to `false`)
2. Confirm API is healthy

---

## 3. Post-Rollback Requirements

### 3.1 Immediate (within 4 hours of rollback)

- [ ] Root cause identified or actively being investigated
- [ ] Scope of data loss communicated to HRA and Product Owner
- [ ] Rollback timeline documented in `#fy2027-golive`

### 3.2 Blameless Post-Mortem (within 48 hours)

File a post-mortem at:
```
infra/runbooks/post-mortems/YYYY-MM-DD-rollback-<short-description>.md
```

Post-mortem template:
```markdown
# Post-Mortem: [Title]

**Date of incident:** YYYY-MM-DD  
**Duration:** HH:MM to HH:MM  
**Authored by:** [name]  
**Reviewed by:** [name, name]

## Summary
[2–3 sentence summary of what happened, impact, and resolution]

## Timeline
| Time | Event |
|------|-------|
| HH:MM | ... |

## Root Cause
[Technical root cause — "what broke and why"]

## Contributing Factors
- ...

## What Went Well
- ...

## Action Items
| Item | Owner | Due |
|------|-------|-----|
| ... | ... | ... |

## Lessons Learned
- ...
```

---

## 4. Re-Launch Checklist

After the fix is deployed and the root cause is confirmed resolved:

- [ ] Fix deployed to staging and verified
- [ ] `bun test` 100% green on fix commit
- [ ] Audit chain verify passes in staging
- [ ] Rollback drill re-executed in staging if fix touches state machine or DB
- [ ] New go-live date agreed with HRA and Product Owner
- [ ] Staff communication sent announcing new date
- [ ] Go/No-Go gate re-run (see `cutover-fy-2027.md` Section 1)
