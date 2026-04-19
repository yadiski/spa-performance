# Staff Performance Analysis Platform — Design Spec

**Status:** Draft, pending review
**Date:** 2026-04-19
**Author:** brainstorm session (Claude + user)
**Target deployment:** January 2027

---

## 1. Executive summary

A single-org internal web platform that digitizes two HR forms (KRA goal-setting, PMS assessment), runs an annual performance cycle with a mid-year checkpoint, provides role-scoped dashboards and analytics, adds AI-assisted suggestions via OpenRouter, and maintains an enterprise-grade immutable audit trail aligned to ISO 9001 and ISO 27001 controls.

Scope is "full platform" (option C from brainstorm), to be delivered by a solo full-time developer over approximately nine months (2026-04 → 2027-01).

---

## 2. Decisions locked during brainstorm

| Area | Decision |
|---|---|
| Deployment model | Single-org internal tool. No multi-tenancy. |
| Scale | 500–2,000 staff. |
| Scope | Full platform (forms + workflow + audit + dashboard + AI + exports). |
| Cycle model | Annual FY cycle. January = close prior FY + set new KRAs. June = mid-year checkpoint (lightweight). |
| Roles | 7: staff, appraiser, next_level, hra, hr_manager, department_head, it_admin. No C-suite role. |
| Reporting hierarchy | Simple tree. One manager per staff. Next-level = manager's manager. HRA override supported. |
| Auth | Better Auth — local accounts (email+password) + TOTP MFA. No corporate SSO. |
| Backend | Bun + Hono, Drizzle ORM, Postgres. Workers share api codebase. |
| Frontend | Vite + React 19, TanStack (Router/Query/Table/Form), shadcn/ui + Tailwind, Zod. |
| Deployment | Railway (web static, api, worker, postgres). |
| AI | OpenRouter, `openai/gpt-5.4-nano`. Five features: staff summary, KRA quality check, development recommendations, calibration assistant, mid-year nudges. |
| Email | Resend. |
| File storage | Cloudflare R2. |
| Retention | Performance records: 7 years post-close. Auth logs: 90d hot, archive beyond. Staff: active + 7 years post-termination. |
| E-signature | Typed-name + server timestamp + IP + UA + hash chain. No DocuSign. |
| Export formats | PDF (signed read-only form) + XLSX (bulk HR). |
| Design language | Apple HID enterprise-formal. No gradients, no AI-slop. Restrained palette, typographic hierarchy, hairline dividers. |

---

## 3. Architecture

### 3.1 Monorepo layout

```
spa-performance/
├─ apps/
│  ├─ web/          Vite + React 19 + TanStack + shadcn   (SPA)
│  └─ api/          Bun + Hono                             (HTTP + background jobs)
├─ packages/
│  └─ shared/       Zod schemas, TS types, constants
├─ infra/
│  ├─ railway.json
│  └─ migrations/   Drizzle migrations
└─ docs/superpowers/specs/
```

Package manager: **Bun workspaces**, throughout.

### 3.2 Runtime topology (Railway)

| Service | Role |
|---|---|
| `web` | Static SPA build, served by Railway static hosting. |
| `api` | Bun + Hono HTTP API. Long-lived. |
| `worker` | Bun process sharing `api` codebase, different entrypoint. Consumes `pg-boss` queue: AI calls, PDF generation, email dispatch, audit archival, scheduled jobs. |
| `db` | Postgres 16 (Railway-managed). |

Single datastore (Postgres). `pg-boss` provides durable queues — no Redis needed.

### 3.3 Typical write-path data flow

```
browser → api (auth check → RBAC check → Zod validate →
           DB transaction: write domain row + audit row + outbox row →
           response) → worker picks outbox → dispatch email + in-app
                    → worker picks AI job → call OpenRouter → write to ai_cache → audit
```

All state-changing routes write inside a single DB transaction that contains both the business write and the audit write. No business mutation is observable without its corresponding audit row.

---

## 4. Data model

### 4.1 Core entities (Drizzle / Postgres)

```
organization           -- single row, org-wide settings, FY definition

department
grade

staff (id, user_id FK→user, name, employee_no, department_id, grade_id,
       designation, manager_id FK→staff, hire_date, terminated_at)

performance_cycle (id, staff_id, fy, state, kra_set_at, mid_year_at, pms_finalized_at)

kra (id, cycle_id, perspective, description, weight_pct, measurement,
     target, order, rubric_1_to_5 jsonb)

kra_progress_update (id, kra_id, reported_at, by_role,
                     result_achieved, rating_1_to_5)

mid_year_checkpoint (id, cycle_id, submitted_at, submitted_by, summary,
                     nudges_accepted jsonb)

pms_assessment (id, cycle_id, state)

pms_kra_rating (id, pms_id, kra_id, final_rating, comment)

behavioural_rating (id, pms_id, dimension_code, rating_1_to_5,
                    rubric_anchor_text, comment)                 -- 22 rows

staff_contribution (id, pms_id, when, achievement, weight_pct)

career_development (id, pms_id, potential_window, ready_in, comments)

personal_growth (id, pms_id, training_needs, comments)

pms_comment (id, pms_id, role, body,
             signed_by FK→user, signed_at, ip, ua,
             signature_hash, prev_signature_hash)

pms_final_snapshot (id, pms_id, finalized_at, finalized_by,
                    score_total, score_breakdown jsonb, pdf_r2_key, pdf_sha256)

cycle_amendment (id, original_cycle_id, reason, opened_by, opened_at, closed_at)
                                                   -- HRA-initiated re-open of a finalized PMS;
                                                   -- links back to the original snapshot;
                                                   -- new amendment writes go to normal tables
                                                   -- but are tagged with cycle_amendment_id.

approval_transition (id, cycle_id|pms_id, from_state, to_state,
                     actor_id, at, note)

audit_log (id, ts, event_type, actor_id, actor_role, target_type, target_id,
           payload jsonb, ip, ua, prev_hash, hash, chain_root)
                                                   -- append-only, hash-chained

audit_anchor (date, root_hash)                      -- daily chain root

notification (id, user_id, event, payload, created_at, read_at, email_sent_at)

ai_cache (id, feature, scope_key, content_hash, model, prompt_hash,
          response_json, tokens_in, tokens_out, cost_cents, created_at)

file_asset (id, scope_type, scope_id, r2_key, filename, sha256, mime,
            uploaded_by, uploaded_at)

session / account / verification / two_factor   -- owned by Better Auth
```

### 4.2 Seed tables

- `behavioural_dimension` — 22 rows, codes + title + description + 5 anchor texts captured verbatim from the PMS form (Communication Skills, Work Quantity & Timeliness, Staff Development, Punctuality & Absenteeism, Adaptability to Changes, Reliability, Customer Focused, Quality Focused, Acceptance of Instructions, Judgment, Teamwork/Cooperation, Initiative, Ability to Learn and Improve, Knowledge and Application of Policies, Computer Literacy, Knowledge of Job, Work Habits, Creative and Analytical Thinking, Interest in Work, Performance Under Pressure, Integrity, Work Organization).
- KRA perspectives enum: `financial`, `customer`, `internal_process`, `learning_growth` — from the Balanced Scorecard pattern observed in the KRA form.

### 4.3 Key design decisions

- **Better Auth owns `user`; HR owns `staff`.** `staff.user_id` joins them. Clean separation of auth from business profile.
- **Rubrics are immutable at point of rating.** `behavioural_rating.rubric_anchor_text` stores the exact anchor text at the time — future rubric updates never alter historical ratings.
- **KRA rubrics are per-KRA.** Stored as `kra.rubric_1_to_5 jsonb` — a 5-element array captured when the KRA is created.
- **Scoring is derived until finalize.** Part IV total = weighted KRAs × 70% + behavioural average × 25% + contribution × 5%. On HRA finalize, the computed score snapshots to `pms_final_snapshot`, which becomes the immutable source of truth. The derivation formula stays only as a cross-check.
- **Audit log is append-only and hash-chained.** `hash = sha256(prev_hash || canonical_json(ts, event_type, actor_id, payload))`. A daily `chain_root` is published to `audit_anchor` (and structured logs) — tampering breaks the chain.
- **E-signature evidence on `pms_comment`.** Captured fields: `signed_by`, `signed_at`, `ip`, `ua`, `signature_hash`, `prev_signature_hash`. Hash chains to prior signature within the same PMS.
- **AI cache** keyed by `(feature, scope_key, content_hash)`. Stale-content-check prevents duplicate charges.

### 4.4 Scale check

2,000 staff × 1 cycle/yr × (4 KRAs + 22 behaviours + 5 contributions + 1 career + 1 growth + 6 comments) ≈ **80,000 rows/cycle** in PMS fan-out tables. Well within single-Postgres territory with proper indexes on `cycle_id`, `staff_id`, `pms_id`, `ts`.

---

## 5. Workflow & state machine

### 5.1 Cycle lifecycle

```
kra_drafting
  └─ submit ──▶ kra_pending_approval
                 ├─ approve ──▶ kra_approved
                 └─ reject  ──▶ kra_drafting (with note)
kra_approved
  └─ HRA opens Jun window ──▶ mid_year_open
                                └─ submit ──▶ mid_year_submitted
                                               └─ ack ──▶ mid_year_done
mid_year_done
  └─ HRA opens PMS window ──▶ pms_self_review
                                └─ submit ──▶ pms_awaiting_appraiser
                                               ├─ submit ──▶ pms_awaiting_next_lvl
                                               │             ├─ submit ──▶ pms_awaiting_hra
                                               │             │             └─ finalize ──▶ pms_finalized  (terminal)
                                               │             └─ return   ──▶ pms_awaiting_appraiser
                                               └─ return   ──▶ pms_self_review
```

### 5.2 Transition rules

- Every transition writes `approval_transition` + `audit_log`.
- "Return-to-X" is first-class; prior submissions remain with original signatures.
- Transitions validate (current state, actor role, actor relationship to target staff). All three must pass.
- `system_config.window_*` gates actions by date. HRA can grant per-staff exceptions (audited).
- `pms_finalized` is terminal. Modification only via HRA-initiated `cycle_amendment` linked to the original — history is never mutated.
- Draft saves do not transition state; only submit actions do.

### 5.3 Role authority over transitions

| Transition | Allowed roles |
|---|---|
| open/close cycle windows | hra |
| draft/submit KRAs | staff (self) |
| approve/reject KRAs | appraiser (of self) |
| submit mid-year update | staff (self) |
| ack mid-year | appraiser |
| submit self-review | staff (self) |
| submit appraiser rating | appraiser |
| return-to-appraisee | appraiser |
| submit next-level review | next_level |
| return-to-appraiser | next_level |
| finalize PMS | hra |
| re-open finalized PMS (amendment) | hra |
| override appraiser/next-level assignment | hra |

---

## 6. Role-based access (RBAC + data scoping)

### 6.1 Roles and permissions

| Role | Actions (highlights) |
|---|---|
| `staff` | view own cycle/PMS; draft/submit KRA; submit mid-year; submit self-review; read own audit trail. |
| `appraiser` | base of `staff` + approve KRAs for direct reports; submit appraiser rating; return to appraisee; read direct reports' cycles. |
| `next_level` | base of `appraiser` + read two levels down; submit next-level review; return to appraiser. |
| `department_head` | read department-scoped cycles (no write); export department XLSX; dept dashboard. |
| `hr_manager` | org-wide read; org exports; org config read/write; **cannot rate**. |
| `hra` | base of `hr_manager` + open/close windows; finalize PMS; re-open PMS (amendment); override assignments; manage rubrics. |
| `it_admin` | user lifecycle; hierarchy edits; audit log read + verify; **cannot read form content**. |

### 6.2 Separation of duties

IT admin manages users but cannot read form content. HR roles read form content but cannot create/disable users. Deliberate ISO 27001 SoD alignment.

### 6.3 Data scoping (row-level, server-enforced)

```
staff            : staff_id = :actor.staff_id
appraiser        : staff_id IN direct_reports(:actor)        ∪ own
next_level       : staff_id IN transitive_reports(:actor, 2) ∪ own
department_head  : staff.department_id = :actor.department_id
hr_manager       : *
hra              : *
it_admin         : user + hierarchy tables only (never form content)
```

Enforcement: single `scopedQuery(actor, entity)` Drizzle wrapper. No route bypasses it. Unit tests lock the contract. Cross-scope reads return `404` (don't leak existence), not `403`.

### 6.4 Multi-role and hierarchy resolution

- One user may hold multiple roles; permissions and scopes are the union.
- `direct_reports` / `transitive_reports` implemented as recursive CTEs over `staff.manager_id`, per-request cached.
- HRA per-cycle overrides of appraiser/next-level take precedence over auto-derived values.

### 6.5 Impersonation

- IT admin only. Time-boxed (default 15 min, max 60). Requires reason. Target user is notified on next login. All actions during impersonation log both impersonator and target.
- HRA has no impersonation.

---

## 7. AI subsystem

### 7.1 Principles

- AI is a suggestion layer, never an authority.
- Every output is stored, cached, traceable, and labeled "AI-generated — review before acting".
- No AI output auto-applies to form data.

### 7.2 Flow

```
route handler ──▶ ai/features/<feature>.ts
                        │
                        ▼
                 ai/core/dispatch.ts  (cache lookup → rate limit → budget guard)
                        │
                 cache miss ▼
                 ai/core/openrouter.ts  (structured output, retries)
                        │
                 ai_cache write + audit_log write
                        │
                        ▼
                     caller
```

### 7.3 Features

| Feature | Trigger | Input | Output (Zod) | Cache key |
|---|---|---|---|---|
| **a. Staff summary** | staff or appraiser opens finalized PMS | cycle snapshot | `{highlights[], concerns[], focus_areas[]}` | `(cycle_id, snapshot_hash)` |
| **b. KRA quality** | appraisee clicks "check my KRAs" | `{perspective, description, measurement, target, rubric[]}` | `{smart_score, issues[], suggested_rewrite}` per KRA | `(kra_id, content_hash)` |
| **e. Dev recs** | career-dev panel | career + growth + behavioural summary + grade | `{training[], stretch[], mentorship[]}` | `(cycle_id, section_hash)` |
| **g. Calibration** | HRA opens calibration | anonymized same-grade peer ratings | `{outliers[], inconsistency_flags[], talking_points[]}` | `(grade_id, fy, cohort_hash)` |
| **h. Mid-year nudges** | mid-year submitted | KRA progress + remaining time | `{per_kra_nudge[], overall_focus}` | `(cycle_id, mid_year_hash)` |

### 7.4 Determinism and safety

- **Structured outputs only.** Every feature declares a Zod schema; OpenRouter JSON-mode + schema validation on response. Schema failure → retry once; second failure → surface error, no malformed output shown.
- **Temperature:** 0 for calibration + quality-check (factual); 0.4 for summaries + nudges (prose tone).
- **No chain-of-thought shown.** Raw response stored for audit; only validated schema fields surfaced.
- **PII minimized in prompts.** Only the needed fields. Calibration uses hashed staff ids, never names.
- **Red-team guards:** reject outputs mentioning protected characteristics; reject outputs claiming to take actions; hard length cap; never echo user-supplied text that could be prompt-injection.
- **Latency budget:** 5s hard timeout. On timeout, user-initiated retry only.

### 7.5 Cost control

- Org-wide daily token cap in `system_config`, set by HRA. Hard stop at cap.
- Per-user rate limit: 20 AI calls/hour.
- Cost visibility: HRA admin view shows per-feature usage and weekly digest email.
- Cache hit rate target ≥ 70% on summary + dev features.

### 7.6 Audit

Every call writes `audit_log { event_type: "ai.<feature>", actor_id, target, prompt_hash, response_hash, tokens_in, tokens_out, cost_cents }`. Full prompt + response in `ai_cache` (7-year retention).

### 7.7 UI affordance

Every AI output carries a monochrome `AI` tag and disclosure "Generated on T · review before acting". Dismiss + regenerate (with reason, audited).

---

## 8. Audit & compliance

### 8.1 Audit log

Append-only, hash-chained Postgres table. Trigger rejects UPDATE and DELETE. Schema in §4.1.

Hash formula: `sha256(prev_hash || ts || event_type || actor_id || canonical_json(payload))`.

Daily anchor: cron at 00:00 UTC computes the final hash of the day and writes to `audit_anchor`. Anchors also printed to structured logs for off-host retention on Railway.

Verifier: `GET /admin/audit/verify?from=:d&to=:d` recomputes the chain and returns "valid" or the first inconsistent row.

### 8.2 What is logged

- Every workflow transition (from, to, actor, note).
- Every rating submission, edit, return.
- Every AI call.
- Every auth event (login success/failure, password change, MFA enroll/disable, session kill, impersonation).
- Every permission-denied attempt.
- Every export download (who, what, when, file hash).
- Every config change (windows, retention, rubrics).
- Every data access outside the actor's default scope (even if permitted).

### 8.3 Data protection controls

| Control | Implementation |
|---|---|
| At-rest encryption | Railway Postgres volume (AES-256). R2 default encryption. |
| In-transit encryption | HTTPS + HSTS preload. TLS 1.3. Railway private network between services. |
| Secrets | Railway env vars. OpenRouter key rotated quarterly. |
| Password policy | Min 12 chars. Breached-password check. No forced rotation (NIST). Lockout after 10 failed attempts. |
| MFA | TOTP mandatory after first login. Single-use recovery codes. |
| Session | 8-hour idle, 7-day absolute. Rotating refresh. Kill-all-sessions action. |
| Rate limiting | Per-IP + per-user on auth; per-user on mutating endpoints. |
| CORS | Allowlist web origin only. |
| CSP | Strict; no inline script/style except hash-allowlisted. |
| Input validation | Zod at every boundary. Parameterized queries via Drizzle only. |
| File uploads | MIME sniff server-side, 10 MB cap. ClamAV sidecar deferred to post-MVP. |
| Logger PII | Redact `password`, `totp_code`, `session_token` by name. |
| Backups | Daily Postgres snapshot (Railway). Weekly restore drill, quarterly documented. |
| Access reviews | Quarterly automated report of roles + scope; flagged if unchanged ≥ 1 yr. |
| Incident readiness | Structured error capture, request-ID correlation to audit. |

### 8.4 ISO alignment

**ISO 9001:** versioned rubrics (DB-audited), deterministic/reproducible exports from finalized snapshots, documented workflow states.

**ISO 27001:** controls above (encryption, MFA, audit, SoD, access reviews). Organizational requirements (asset register, risk register, SoA, staff awareness, physical security, supplier review) are explicitly out of app scope.

### 8.5 Retention

| Data | Retention |
|---|---|
| Performance records (KRA, mid-year, PMS) | 7 years after cycle close |
| Auth/access audit | 90 days hot, Parquet archive beyond (still queryable) |
| Staff records | active + 7 years post-termination |
| AI cache | 7 years (aligned with performance records) |
| Exports | 1 year in R2, then prune (generated outputs are re-derivable from snapshot) |

---

## 9. UI structure

### 9.1 Route map (TanStack Router, file-based)

```
apps/web/src/routes/
├─ _auth/                         (pre-login)
│  ├─ login.tsx
│  ├─ mfa.tsx
│  ├─ password-reset.tsx
│  └─ set-password.tsx
│
├─ _app/                          (authed shell)
│  ├─ index.tsx                   redirect by primary role
│  ├─ me/
│  │  ├─ index.tsx
│  │  ├─ cycle.$fy.tsx
│  │  ├─ kra.tsx
│  │  ├─ mid-year.tsx
│  │  ├─ pms.tsx
│  │  ├─ profile.tsx
│  │  └─ history.tsx
│  ├─ team/
│  │  ├─ index.tsx
│  │  ├─ pending.tsx
│  │  └─ $staffId/
│  │     ├─ cycle.tsx
│  │     ├─ kra-approve.tsx
│  │     ├─ mid-year-review.tsx
│  │     └─ pms-review.tsx
│  ├─ department/
│  │  ├─ index.tsx
│  │  └─ people.tsx
│  ├─ hr/
│  │  ├─ index.tsx
│  │  ├─ cycles.tsx
│  │  ├─ calibration.tsx
│  │  ├─ finalize.$cycleId.tsx
│  │  ├─ rubrics.tsx
│  │  ├─ exports.tsx
│  │  └─ ai-budget.tsx
│  ├─ admin/
│  │  ├─ users.tsx
│  │  ├─ hierarchy.tsx
│  │  ├─ audit.tsx
│  │  ├─ sessions.tsx
│  │  └─ system.tsx
│  ├─ staff-directory.tsx
│  └─ notifications.tsx
└─ __root.tsx
```

### 9.2 Shell

- Left sidebar with role-union sections; collapses to icons at ≤ 1024px.
- Top bar: breadcrumb, cycle-phase indicator, notification bell, avatar menu.
- Modals reserved for destructive confirmations only (finalize, re-open, impersonate).

### 9.3 Design system

- `packages/shared/ui` wraps shadcn primitives with enterprise-formal tokens (palette, typography, radii, hairlines — rules in user-preference memory).
- Shared components: `DataTable` (TanStack Table + styled shell), `AppForm` (TanStack Form + Zod + auto-save + server-error surface), `ProgressBar` (solid fill + hairline tick), `AuditTrail` (inline hash-chain history).

### 9.4 Forms

- **PMS is a stepped form**, 5 steps: (1) KRA results, (2) Behavioural (22 dimensions in clusters of 4–6), (3) Contribution, (4) Career dev + personal growth, (5) Comments + sign. Auto-save on blur (300ms debounce) via `PATCH /pms/:id/draft`.
- **Behavioural dimensions render anchors verbatim** — rater picks the anchor that matches; the rating is derived from the chosen anchor. `rubric_anchor_text` captured on the rating row.
- **KRA form enforces weight total = 100%** with a live footer counter. Submit blocked until valid; drafts allowed in-progress.
- **Resume anywhere:** returning to a half-done form lands on the first incomplete step. Reviewers see the whole form read-only, with their section the only editable block.

### 9.5 Lists and dashboards

- All lists: TanStack Table, server-side pagination/sort/filter, URL-synced state via TanStack Router search params.
- Dashboards: role-scoped index pages. Shared widget library. "June → current trajectory" progress bar is the centerpiece in staff + appraiser + dept views.
- Exports queue a background job. Notification on ready. Download via signed R2 URL.

### 9.6 Accessibility

- Keyboard navigation throughout. shadcn + TanStack ship ARIA; we audit.
- Target WCAG 2.1 AA contrast (palette already compliant).
- Respect `prefers-reduced-motion`.
- Screen-reader labels on numeric data cells with context.

---

## 10. Non-functional requirements

| Area | Target |
|---|---|
| Latency | p95 < 400ms on reads, < 800ms on writes (excluding AI calls). |
| Availability | Single-region, Railway-managed. Designed for ~99.5% — not a 24/7 system. |
| Error budget | Structured errors returned to client with stable codes; no stack traces. |
| Observability | Request ID on every request, propagated to logs + audit rows. Error capture via Sentry-compatible client. |
| Testing | Unit tests for scoping, workflow transitions, hashing, Zod schemas. Integration tests for auth + one happy-path per form step. Contract tests for AI feature schemas. |
| CI | Bun test + type-check + lint on PR. Drizzle migration dry-run. No deploy without green build. |
| Migrations | Drizzle migrations reviewed per PR. Never destructive without explicit flag + backup confirmation. |

---

## 11. Phased delivery within the 9-month window

Not committed phases — a working plan to be refined in the implementation planning step. Illustrative split:

| Window | Deliverable |
|---|---|
| 2026-04 → 2026-06 | Monorepo scaffold, Better Auth, Postgres + Drizzle, staff + user + hierarchy, RBAC wrapper, audit-log foundation, KRA form end-to-end, minimal staff dashboard. |
| 2026-07 → 2026-09 | Mid-year checkpoint, PMS form (all 6 parts), behavioural dimension seed + rubric-anchor UX, approval workflow with return paths, e-sign evidence, PDF export. |
| 2026-10 → 2026-11 | AI subsystem + all five features, role-scoped dashboards (team, dept, HR, admin), calibration view, XLSX exports, Resend integration, notification inbox. |
| 2026-12 | Compliance hardening pass: audit verifier, access reviews, retention cron, impersonation, CSP/HSTS/rate limiting polish, ClamAV if time permits. |
| 2027-01 | Production cutover: bulk import, user onboarding, FY 2027 cycle opens on the platform. |

Scope-creep protection: any new feature request must displace something already in the window.

---

## 12. Explicit non-goals / deferred

- Multi-tenant SaaS.
- Corporate SSO (Entra, Google). Local accounts only.
- Outlier / bias detection AI (feature d).
- Rating-consistency AI check (feature c).
- Comment sentiment / theme extraction AI (feature f).
- C-suite / executive dashboard.
- DocuSign / PKI e-signatures.
- Mobile-first UX (responsive is required; native/PWA is not).
- 24/7 SRE / multi-region DR.
- ISO certification itself (organizational, not an app feature).

---

## 13. Open items to resolve during implementation planning

- PDF generation library choice: React-PDF vs Puppeteer vs Gotenberg. Tradeoff: React-PDF is in-process + simple but limited CSS; Puppeteer/Gotenberg render faithfully but add a runtime dependency.
- Whether to adopt Hono RPC for end-to-end types or keep an OpenAPI layer. Leaning Hono RPC for velocity.
- Exact FY boundaries (calendar year vs org fiscal year). Default: calendar year Jan–Dec unless org policy says otherwise.
- Bulk staff import format (HRIS CSV shape, required columns, update semantics on re-import).
- Department/grade initial seeds: import from where.

---

## 14. References

- `references/Sample KRA form Exec.doc` — authoritative KRA form.
- `references/PMS form Exec.doc` — authoritative PMS form.
- Brainstorm session 2026-04-19 (memory files under `memory/`).
