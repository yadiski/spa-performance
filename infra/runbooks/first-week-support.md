# First-Week Support Runbook (T46)

**Owner:** IT Admin (daily digest compiler)  
**Period:** T+1 through T+14 after go-live  
**Standup:** Daily 09:00, HRA + IT Admin + Tech Lead

---

## 1. Daily Digest

Compile at end of each business day (by 17:30) and share in `#fy2027-support` channel and by email to HRA + Product Owner.

### Template

```
========================================
FY 2027 FIRST-WEEK SUPPORT DIGEST
Date: YYYY-MM-DD (Day N of 14)
Compiled by: [name]
========================================

SUMMARY
Active staff with open KRA windows: [N]
KRAs submitted today: [N]
KRAs approved today: [N]
Notifications sent today: [N] (check worker logs)
PDF generations today: [N]
Support tickets received: [N]

─── BLOCKERS (SLA: 4 hours) ──────────────────────
[List each blocker with: reported time, description, owner, status, ETA]

Example:
• 14:22 | Staff cannot submit KRAs — 409 INVALID_STATE error | Owner: @engineer | Status: IN PROGRESS | ETA: 16:00

─── FRICTION (SLA: 48 hours) ─────────────────────
[List each friction item: description, frequency (how many staff affected), owner, status]

Example:
• Trajectory bar shows 0% for newly approved KRAs | Affects 3 staff | Owner: @engineer | Status: QUEUED

─── FEATURE REQUESTS (Out of scope for FY2027 launch) ──
[List each request, requester, and disposition]

Example:
• "Can I re-open my KRA after approval?" | 2 staff | Disposition: BACKLOGGED — post-FY2027

─── RESOLVED TODAY ───────────────────────────────
[Items resolved since yesterday's digest]

─── TOMORROW'S PRIORITIES ─────────────────────────
1. [Item]
2. [Item]

========================================
```

---

## 2. Issue Categories and SLAs

### Blocker

**Definition:** Any issue that prevents a staff member from completing a required workflow step and cannot be worked around.

Examples:
- Cannot log in (auth failure, not password reset)
- Cannot submit KRAs (form error, API 5xx)
- Cannot see the app at all (outage)
- Notifications not sending (staff unaware of required action)
- PDF download link broken

**SLA:** Respond within 1 hour, resolve within 4 hours.  
**Escalation if unresolved in 2 hours:** Tech Lead paged directly.

### Friction

**Definition:** Issue that causes confusion or slows down a user but does not block completion.

Examples:
- UI text is confusing
- Loading spinners appear for > 5 seconds
- Dashboard data appears stale
- Incorrect score displayed (but workflow still completes)

**SLA:** Acknowledge within 4 hours, resolve within 48 hours.

### Feature Request (Out of Scope)

**Definition:** Something the user wants that was not part of the FY2027 launch scope.

Examples:
- Bulk editing KRAs after submission
- Manager-initiated KRA template
- Export to Excel from the dashboard

**Handling:** Log in the backlog, thank the requestor, set expectation for post-launch review.  
**No SLA** — these are not bugs.

---

## 3. Feedback Channel

| Channel | Purpose |
|---------|---------|
| `#fy2027-support` (Slack) | Real-time issue triage between IT Admin, tech lead, and HRA |
| Shared HR inbox `hr-admin@yadiski.my` | Staff-facing support; HR forwards technical issues to IT |
| Daily standup (09:00) | Structured review of blockers, friction, and digest review |
| Weekly HR feedback meeting (Fridays) | Broader feedback from HR team; future roadmap items collected |

---

## 4. Escalation Path

```
Staff reports issue
  → HR Admin (hr-admin@yadiski.my)
    → IT Admin (it@yadiski.my) if technical
      → Tech Lead (direct message or phone) if blocker not resolving
        → Product Owner if rollback or scope decision needed
```

---

## 5. Monitoring Checklist (IT Admin, check each morning)

Run before the 09:00 standup:

```bash
# 1. API health
curl https://your-domain/healthz
curl -H "x-health-token: $HEALTH_CHECK_TOKEN" https://your-domain/api/v1/healthz/deep

# 2. Failed notification jobs in last 24h
psql $DATABASE_URL -c "
  SELECT name, count(*) FROM pgboss.job
  WHERE state = 'failed'
    AND created_on > now() - interval '24 hours'
  GROUP BY name;
"

# 3. Failed export jobs
psql $DATABASE_URL -c "
  SELECT status, count(*) FROM export_job
  WHERE created_at > now() - interval '24 hours'
  GROUP BY status;
"

# 4. Auth lockouts in last 24h
psql $DATABASE_URL -c "
  SELECT count(*) FROM lockout_event
  WHERE created_at > now() - interval '24 hours';
"

# 5. Audit chain verify (last 24 hours)
curl -H "Authorization: Bearer $HRA_TOKEN" \
  "https://your-domain/api/v1/admin/audit/verify?from=$(date -d yesterday +%Y-%m-%d)&to=$(date +%Y-%m-%d)"
```

All checks should be green before the standup. Anomalies → raise as blockers or friction immediately.

---

## 6. Wrap-Up at T+14

At the end of the two-week support window, IT Admin and HRA jointly sign off on:

- [ ] All blocker-severity issues resolved
- [ ] Friction items either resolved or backlogged with owners and dates
- [ ] Feature request backlog handed to Product Owner
- [ ] Final daily digest sent covering T+13/T+14
- [ ] First-week retro document filed: `infra/runbooks/post-mortems/fy2027-golive-retro.md`

The retro should cover:
- What staff found most confusing (top 3)
- What the team found hardest to support (top 3)
- What went smoothly
- Recommended process improvements for next cycle
