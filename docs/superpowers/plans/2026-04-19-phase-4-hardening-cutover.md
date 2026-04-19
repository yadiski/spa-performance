# Phase 4 — Hardening + Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Expansion note:** This plan is the Phase-4 roadmap. Tasks, files, goals, and acceptance criteria are concrete; TDD sub-step expansion is deferred until Phase 3 ships. Re-invoke `superpowers:writing-plans` on this document when Phase 3 completes.

**Goal:** Harden the platform to a production-ready state for the January 2027 cutover. Close every compliance gap from the spec's §8 (audit + compliance). Run rehearsals of the real-world cycle. Migrate staff data and hierarchy from whatever authoritative source the org uses. Onboard first real users with minimal friction.

**Architecture:** No new feature surface. Every task tightens something: audit verification, retention, access reviews, session controls, rate limiting, observability, backup/restore, and the cutover runbook itself.

**Spec reference:** §8 (audit + compliance), §10 (non-functional requirements), §11 (phased delivery cutover).

**Window:** 2026-12 → 2027-01 (8 weeks).

**Phase-4 exit criteria:**
1. Audit chain verifier endpoint + daily anchor cron running + alerting if a day's chain fails.
2. Retention cron moves audit rows older than 90 days to R2 Parquet archive; archive is still queryable via a thin reader.
3. Quarterly access review report generated automatically and emailed to HRA + IT admin; action items tracked.
4. Impersonation feature (IT admin only) with time-box, reason, target notification, full audit.
5. CSP, HSTS, rate-limit-per-route, account lockout, session timeout — all present and tested.
6. File-upload AV scan (ClamAV sidecar) integrated OR deferred with explicit risk acceptance documented.
7. Password reset + MFA recovery flows usable without admin intervention.
8. Weekly Postgres restore drill documented; last drill date ≤ 7 days old.
9. Bulk import pipeline: HRIS CSV → staging → validation report → apply; idempotent, reversible.
10. Onboarding flow: new user receives email → sets password → enrolls TOTP → lands on correct role-based page.
11. Dry-run of FY 2027 cycle opening end-to-end in a staging copy of production data.
12. Runbook: cutover checklist, rollback plan, on-call contacts.
13. Go-live: FY 2027 KRA window opens on the platform; first cohort of staff begins drafting.

---

## File structure (additions)

```
apps/api/src/
├─ audit/
│  ├─ archive.ts                 NEW  rotate hot rows → R2 Parquet
│  ├─ anchor-alert.ts            NEW  detect missing/mismatched daily anchor
│  └─ reader-archive.ts          NEW  query across hot + cold
├─ compliance/
│  ├─ access-review.ts           NEW  generate quarterly review data
│  ├─ retention.ts               NEW  policy: staff, cycles, ai_cache
│  ├─ impersonation.ts           NEW  start/stop with audit
│  └─ csp.ts                     NEW  Content-Security-Policy header builder
├─ http/
│  ├─ rate-limit.ts              MOD  per-route rules + account-lockout
│  ├─ security-headers.ts        NEW  HSTS, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy
│  └─ middleware-order.ts        NEW  explicit middleware composition doc + test
├─ observability/
│  ├─ request-id.ts              MOD  correlate to audit rows
│  ├─ logger.ts                  NEW  structured logger + PII redaction
│  └─ errors.ts                  MOD  Sentry-compatible client (self-hosted or cloud)
├─ onboarding/
│  ├─ invite.ts                  NEW  send magic-link invitation
│  └─ routes.ts                  NEW
└─ jobs/
   ├─ quarterly-access-review.ts NEW
   ├─ retention-rotate.ts        NEW
   ├─ audit-anchor-alert.ts      NEW
   └─ weekly-restore-drill.ts    NEW  (runs in staging env only)

apps/web/src/
├─ routes/_app/admin/
│  ├─ audit.tsx                  MOD  add chain verifier UI
│  ├─ sessions.tsx               MOD  add impersonation UX
│  └─ access-review.tsx          NEW
├─ routes/_auth/
│  ├─ invite-accept.tsx          NEW  invited-user password+TOTP setup flow
│  ├─ password-reset.tsx         MOD  strengthen + resume
│  └─ mfa-recover.tsx            NEW  backup-code recovery

infra/
├─ runbooks/
│  ├─ cutover-fy-2027.md         NEW  step-by-step cutover plan
│  ├─ rollback.md                NEW  how to revert
│  ├─ restore-drill.md           NEW  documented weekly procedure
│  ├─ incident-response.md       NEW  on-call steps for common incidents
│  └─ access-review.md           NEW  quarterly process
├─ migrations/
│  └─ clamav-sidecar.md          NEW  decision + how to enable
└─ import/
   ├─ staging-template.csv       NEW
   └─ validator-rules.md         NEW
```

---

## Task index

### 4.1 Audit hardening
1. Daily anchor cron verification: enforce that today's anchor row exists by 00:10 UTC; alert if missing (email HRA + IT admin).
2. Audit chain verifier endpoint `/admin/audit/verify` with UI in admin panel.
3. Archive job: nightly, move `audit_log` rows older than 90 days to R2 Parquet; keep chain root + verifier data intact; delete hot rows only after successful upload.
4. Archive reader: transparent query across hot + cold (thin implementation using DuckDB or direct Parquet read via `read_parquet` extension).
5. Alert wire-up: any verification failure pages via a separate channel (Resend to HRA + IT admin) — this is "something is wrong with the audit chain", not a standard notification.

### 4.2 Access control hardening
6. Account lockout: 10 failed login attempts within 10 minutes locks the account for 30 minutes; HRA or IT admin can unlock (audited).
7. Session timeout: enforce 8-hour idle + 7-day absolute. Kill-all-sessions for self + IT admin on target user.
8. Impersonation: IT admin only. Start → prompt for reason, fixed 15-min expiry (max 60 with justification), target user gets in-app + email notification on next login; every action during impersonation logged with both impersonator id and target id.
9. Password policy enforcement: min 12 chars, breached-password lookup via k-anonymity SHA-1 prefix (HIBP-compatible); no forced rotation; account lockout on repeated failures.
10. MFA recovery: single-use recovery codes (10, generated at enrollment), usable in `/auth/mfa-recover`; re-enrollment required after using a code.
11. Cross-scope access attempts logged as `security.scope_violation`; explicit audit event type.

### 4.3 Network + transport
12. Security headers middleware: HSTS (preload, 1-year), CSP (strict, hash-allowlist inline, no `unsafe-inline`), X-Frame-Options DENY, Referrer-Policy no-referrer, Permissions-Policy with all sensitive features disabled.
13. Per-route rate limits: auth endpoints 10/min/IP + 20/min/user; mutating endpoints 60/min/user; AI endpoints 20/hr/user (already in Phase 3).
14. CORS tightening: allowlist only production web origin; separate staging/prod configs.
15. TLS enforcement: verify Railway gateway enforces TLS 1.3; document.

### 4.4 Retention + data lifecycle
16. Retention policy constants in code (`compliance/retention.ts`): Performance records 7 years post-close, Auth hot 90 days, Staff active + 7 years post-termination, AI cache 7 years, Exports 1 year.
17. Retention jobs: one per entity type; safe deletion with pre-export audit.
18. Terminated-staff flow: when `staff.terminated_at` is set, disable user, kill sessions, anonymize profile fields after 7 years (retain employee_no + terminated_at + any legal-hold references).

### 4.5 File scanning
19. ClamAV sidecar decision: evaluate Railway feasibility. If enabled, every file uploaded via R2 goes through a queued scan; quarantine infected files and notify uploader. If deferred, document the risk acceptance with sign-off.

### 4.6 Observability + incident readiness
20. Structured JSON logger with PII redaction (password, totp_code, session_token, email optional per-event).
21. Request-ID in every log + attached to audit rows for correlation.
22. Error capture (Sentry or a self-hosted equivalent); redact same PII fields.
23. Uptime probe: external monitor hitting `/healthz` every minute; alerts via email.
24. Runbook: `infra/runbooks/incident-response.md` with common failures (DB down, worker stuck, email bounces, audit chain break).

### 4.7 Backup + restore
25. Confirm Railway daily snapshot is enabled and tested.
26. Weekly restore drill script (runs in staging): restore latest snapshot → run `verifyChain(from=30d-ago,to=today)` → report success.
27. Runbook: `infra/runbooks/restore-drill.md` — manual + automated steps.

### 4.8 Bulk import pipeline
28. Staging table `staff_import_stage` — upload CSV → validate → report errors → apply in one transaction.
29. Validator rules: required fields, valid department/grade codes, unique employee_no, resolvable manager chain with no cycles.
30. Idempotency: re-import of the same CSV is a no-op (primary key: employee_no + content hash).
31. Reversal: last import stored; HRA can "undo" an import within 24 hours (restores prior rows).
32. Runbook: `infra/runbooks/bulk-import.md`.

### 4.9 Onboarding + first-run
33. Invite flow: HRA or IT admin creates a user → Resend invitation email with magic link (single-use, 7d expiry) → user sets password + enrolls TOTP → lands on role-appropriate page.
34. Password reset: email-initiated, magic-link, expires 1h, one-time use.
35. First-login checklist UI: verify profile, confirm department + manager, review assigned role.
36. Welcome email with onboarding help doc link.

### 4.10 Access reviews
37. Quarterly cron: generate a report per user (roles, scope, last login, anything unchanged > 1yr) → email HRA + IT admin.
38. UI view at `/admin/access-review` for HRA + IT admin to approve, revoke, or defer.
39. Revoke action removes role(s), kills sessions, audits.
40. Runbook: `infra/runbooks/access-review.md`.

### 4.11 Rehearsal + cutover
41. Staging clone: replicate production DB into staging (masked PII) monthly in Dec 2026.
42. Cutover rehearsal #1 (first week of December 2026): open a dry-run FY 2027 cycle in staging; HR team walks through KRA setup for 3 test staff.
43. Cutover rehearsal #2 (third week of December 2026): full-team rehearsal; verify email delivery, PDF generation, audit chain, all dashboards.
44. Rehearsal #3 (first week of January 2027): final dress run; freeze code except blocker fixes.
45. Go-live (second/third week of January 2027): open FY 2027 KRA window on production; monitor; 24–48h war-room on-call.
46. First-week support: daily digest of issues, quick-response fixes, feedback loop with HR.

### 4.12 Documentation
47. Operator docs: admin guide (IT admin), HRA handbook (cycle management).
48. End-user help: staff quickstart, appraiser quickstart, FAQ.
49. API reference: auto-generated from Zod schemas + Hono route metadata.
50. Security posture summary: ISO 27001 control mapping (informational, not audit-ready).

---

## Design notes

### Daily audit anchor + alert

```
cron 00:05 UTC: runDailyAuditAnchor(yesterday)
cron 00:10 UTC: verifyAnchorExistsFor(yesterday)
  if missing OR verify chain fails: sendAlert(to=HRA+ITAdmin, severity=critical)
```

Alert uses a distinct Resend template with clear severity — this is "something may be wrong with compliance".

### Impersonation audit pattern

```
audit_log { event_type: "impersonation.start", actor_id: it_admin_user, target_id: target_user, payload: { reason, expires_at } }
...actions during impersonation...
  each action logs BOTH the impersonator and the target via a `context.impersonating` field
audit_log { event_type: "impersonation.end", actor_id: it_admin_user, target_id: target_user }
```

Target user notification sent on next login: "Your account was impersonated by <admin name> from T to T for reason R. If this is unexpected, contact security." — no real-time notification (would interrupt support work).

### CSP strategy

Start strict:

```
default-src 'self';
script-src 'self' 'sha256-<known-inline>' ;
style-src 'self' 'sha256-<known-inline>' ;
img-src 'self' data:;
font-src 'self';
connect-src 'self' https://api.openrouter.ai https://api.resend.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

Each `<script>` or `<style>` inline must be hashed into the CSP. For Vite, produce a build plugin that emits the CSP alongside the HTML.

### Retention anonymization

When `staff.terminated_at + 7 years` is reached:

- Keep: `staff.id`, `staff.employee_no`, `staff.terminated_at`, `staff.org_id`.
- Keep: all `performance_cycle` + `pms_final_snapshot` rows (7-year retention starts at cycle close, not termination).
- Nullify: `staff.name`, `staff.designation`, `staff.department_id`, `staff.grade_id`, `staff.manager_id`, `staff.user_id` and delete the linked `user` row.
- Leave audit log intact — it references user ids that may now be null; the audit stays truthful about what happened.

### Rehearsals are non-negotiable

Each rehearsal writes a post-mortem doc listing what broke, what was confusing, what was missing. Three rehearsals = three chances to fix before a real cycle starts.

### Go-live gate checklist

Do not go live until every item is green:

- [ ] Latest Phase-1 through Phase-4 tag deployed on production.
- [ ] Restore drill within past 7 days succeeded.
- [ ] Last daily audit anchor present for every day in past 30 days.
- [ ] Staging rehearsal #3 completed with no blocker findings.
- [ ] All 500–2,000 staff imported; hierarchy resolves with no cycles.
- [ ] All staff invited; ≥ 90% have completed first-login (password + TOTP).
- [ ] HR team trained; HRA handbook signed off.
- [ ] On-call rotation set for first 2 weeks.
- [ ] Rollback plan rehearsed once.

---

## Phase-4 exit verification checklist

- [ ] FY 2027 KRA window open on production.
- [ ] First 50 staff completed KRA draft on the platform without HR intervention.
- [ ] Appraisers able to approve at scale (at least one approval per appraiser across 20+ appraisers).
- [ ] Audit chain verifies daily for go-live period.
- [ ] Restore drill passes weekly.
- [ ] Zero critical security issues open.
- [ ] Retention jobs running nightly with no errors.
- [ ] Access review scheduled for 2027-Q1.
- [ ] Runbooks complete and committed.
- [ ] Project moves from "build" to "operate + improve" mode.
