# FY 2027 Cutover Runbook (T45 / also governs T42–T44 rehearsals)

**Owner:** HRA + IT Admin  
**Tech Lead:** On-call engineer  
**Go-live target:** Second/third week of January 2027  
**Rehearsal schedule:** See `rehearsal-checklist.md`

---

## Roles and Responsibilities

| Role | Responsibility |
|------|---------------|
| HRA (HR Admin) | Owns the business decision to proceed; opens KRA window; communicates with staff |
| IT Admin | Infra checks, deploy, monitoring, escalation path |
| On-call Engineer | Watches error rates, logs, notifications; approves Pilot-to-Full rollout |
| Product Owner | Final sign-off on go/no-go; manages stakeholder comms |

---

## Go/No-Go Gate (T-7)

All items must be checked before the T-3 deploy freeze.

- [ ] All three rehearsals completed with no unresolved blockers
- [ ] Rollback drill executed in staging and documented
- [ ] Audit chain `verifyChain` passes for last 30 days in staging
- [ ] PDF generation tested on 10+ real-data cycles; hashes stable
- [ ] Email delivery confirmed for all notification templates in staging
- [ ] All dashboards (me, manager, HRA, AI panels) rendering correctly
- [ ] Performance: p95 API latency < 400 ms under 50 concurrent users (staging load test)
- [ ] `bun test` 100% green on the release commit
- [ ] Biome lint clean on the release commit
- [ ] Railway health check `/healthz` and `/api/v1/healthz/deep` both green
- [ ] On-call rota confirmed (at least two engineers available 08:00–22:00 on T+0 and T+1)
- [ ] Comms plan sent (see Section 6)

---

## Pre-Cutover Timeline

### T-7 (first week of January 2027)

08:00 — Staging rehearsal #3 complete sign-off meeting (HRA + IT Admin + Tech Lead).  
09:00 — Walk the Go/No-Go gate checklist above.  
10:00 — If all green: proceed. If any blocker: record in `post-mortems/` and reschedule.  
14:00 — Send T-7 staff announcement email (template in Section 6).

### T-3 (approximately 2027-01-13)

09:00 — Production deploy freeze begins. Only critical blocker fixes may be merged.  
09:30 — IT Admin confirms deployed commit SHA matches the signed-off release.  
10:00 — Final smoke test on production (no data changes; read-only checks).  
12:00 — On-call rota confirmed and briefed.

### T-1 (day before go-live)

08:00 — Final prod smoke test:
  - `GET /healthz` → `{"status":"ok"}`
  - `GET /api/v1/healthz/deep` (with token) → `{"db":"ok","r2":"ok"}`
  - Audit chain verify for last 30 days: `GET /api/v1/admin/audit/verify?from=...&to=...`
  - One notification send test (use IT Admin mailbox as guinea pig)
  - One PDF generate + download test

10:00 — HRA confirms staff list is correct (no unexpected terminations, no missing joiners).  
14:00 — Comms sent: T-1 reminder email to all staff (template in Section 6).  
17:00 — All-clear from tech lead; on-call briefed on rollback trigger criteria.

---

## T+0 — Go-Live Day

### 08:00 — Open FY 2027 KRA Window (Pilot Cohort)

Performed by **HRA** in the web UI or via API:

1. Log into the app as HRA.
2. Navigate to **Cycle Admin** → **Bulk Open**.
3. Select **Scope: Staff IDs** and enter the 50 pilot staff IDs.
4. Set **FY = 2027**, **action = open_kra_window**.
5. Click **Open Window** and confirm.
6. Verify: at least one pilot staff member sees the KRA setup form in their dashboard.

API equivalent (if UI is unavailable):
```bash
curl -X POST https://your-domain/api/v1/cycle/open-kra-bulk \
  -H "Authorization: Bearer $HRA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"staffIds","staffIds":["<uuid1>","<uuid2>",...]}'
```

### 08:15 — Confirm Notifications Sent

Check Railway worker logs for `send-notification` jobs completing successfully:
```
railway logs --service worker --tail 100 | grep send-notification
```

Expected: one `email.kra_window_opened` notification per pilot staff member within 10 minutes.

### 08:30 — War Room Opens

IT Admin and on-call engineer join the designated Slack channel `#fy2027-golive` and stay active.

### 10:00 — Two-Hour Check

Review the following before opening the remaining cohort:

| Metric | Threshold | Check |
|--------|-----------|-------|
| API error rate (5xx) | < 1% of requests | Railway → Metrics → HTTP errors |
| p95 latency | < 500 ms | Railway → Metrics → Response time |
| Notification jobs failed | 0 | pg-boss: `select count(*) from pgboss.job where state='failed' and name='send-notification'` |
| Auth lockouts | 0 unexpected | `select count(*) from lockout_event where created_at > now() - interval '2 hours'` |
| Pilot staff complaints | 0 blockers | HR confirms via WhatsApp/email |

If all metrics are clean → proceed to 14:00 full rollout.  
If any threshold breached → invoke rollback (see `rollback.md`).

### 14:00 — Open Remaining Cohort

1. HRA: **Bulk Open** → **Scope: Org** (or remaining departments).
2. Confirm notification wave completes within 20 minutes.
3. Tech lead logs the time, cohort size, and notification count in `#fy2027-golive`.

### 16:00 — End of Day Status

IT Admin compiles the first daily digest (template in `first-week-support.md`) and shares with HRA and Product Owner.

---

## T+1 through T+14 — First-Week Support

See `first-week-support.md` for the daily digest template and triage SLAs.

Daily standup: 09:00 with HRA, IT Admin, and tech lead.  
Triage channel: `#fy2027-support`.

---

## 6. Communications Plan

### 6.1 T-7 Announcement (send to all staff)

> **Subject: FY 2027 Performance Management Cycle — Opening Soon**
>
> Dear [Name],
>
> We are pleased to announce that the FY 2027 Key Results Areas (KRA) window will open on [DATE]. You will receive a separate notification when your window is ready.
>
> To prepare:
> - Log into the system at [URL] and verify your profile is up to date.
> - Review last year's KRA if you have access to it.
> - If you have any login issues, contact IT at it@invenioptl.com.
>
> Your appraiser and HR team are available for any questions.
>
> Regards,  
> HR Administration

### 6.2 T-1 Reminder (send to all staff)

> **Subject: FY 2027 KRA Window Opens Tomorrow**
>
> Dear [Name],
>
> A reminder that the FY 2027 KRA window opens tomorrow morning. You will receive an in-app notification and email when your window is active.
>
> Please ensure you can log in today. If you have any issues, contact IT immediately at it@invenioptl.com so we can resolve them before launch.
>
> Regards,  
> HR Administration

### 6.3 T+0 Pilot Notification (system-generated, verify template in code)

Triggered automatically by the `kra_window_opened` notification job. Subject line:
> **Your FY 2027 KRA Window Is Now Open — Action Required**

### 6.4 Appraiser Notification (sent after pilot staff submit KRAs)

> **Subject: Staff KRAs Submitted for Your Review**
>
> Dear [Appraiser Name],
>
> [Staff Name] has submitted their FY 2027 KRAs for your review. Please log in to review and approve them within 5 business days.
>
> [Link to App]
>
> Regards,  
> Performance Management System

---

## 7. Escalation Path

```
Issue reported by staff
  → HR Admin triage (immediate)
    → IT Admin (if technical)
      → On-call Engineer (if systemic/outage)
        → Tech Lead (unilateral rollback authority for data integrity issues)
          → Product Owner (if rollback decision involves business impact)
```

For rollback criteria and procedure: see `rollback.md`.

---

## 8. Post-Launch Sign-Off

After T+14, HRA and Tech Lead jointly confirm:
- [ ] All staff in scope have an active FY 2027 cycle
- [ ] No unresolved blockers
- [ ] All P1 friction items resolved or backlogged with a date
- [ ] Audit chain verified for T+0 through T+14
- [ ] First-week support retrospective documented in `post-mortems/fy2027-golive-retro.md`
