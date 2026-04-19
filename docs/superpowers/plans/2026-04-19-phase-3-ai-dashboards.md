# Phase 3 — AI + Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Expansion note:** This plan is the Phase-3 roadmap. Tasks, files, goals, and acceptance criteria are concrete; TDD sub-step expansion (exact test code, exact implementation code) is deferred until Phase 2 ships. Re-invoke `superpowers:writing-plans` on this document when Phase 2 is complete to expand each task into bite-sized TDD steps.

**Goal:** Layer AI-assisted analysis and role-scoped analytics onto the real performance data that Phase 2 began producing. Five AI features behind a single dispatch/cache/audit spine. Role-specific dashboards for team, department, HR, and admin audiences. XLSX exports for HR reporting. Calibration view for HRA.

**Architecture:** A new `ai/` subsystem with `core` (dispatch, cache, budget, OpenRouter client) and `features/` (one module per feature). New dashboard components share a widget library; differences between roles are data-scoping and widget composition, not separate implementations. XLSX exports queue through the existing pg-boss job system.

**Tech Stack (additions):** `openai` SDK or raw fetch for OpenRouter, `exceljs` for XLSX generation, `recharts` for dashboard charts (aligned with the enterprise-formal design tokens — no default theming), `date-fns` for time-window math.

**Spec reference:** §7 (AI subsystem), §9.5 (dashboards), §9.4 (exports).

**Window:** 2026-10 → 2026-11 (8 weeks, solo full-time).

**Phase-3 exit criteria:**
1. All 5 AI features produce schema-validated, cached, audited output via a single `ai/core/dispatch.ts`.
2. AI budget guard blocks calls past the daily cap; admin UI shows usage + cost.
3. Staff summary, KRA quality, dev recommendations, calibration, mid-year nudges each have at least one integration test with a mocked OpenRouter that asserts cache hit/miss, audit row, schema validation.
4. Team dashboard shows direct-reports trajectory table + pending-my-action + team-summary stats.
5. Department dashboard shows department rollup + distribution histogram + scope-bounded search.
6. HR dashboard shows org-wide completion %, score distribution, cycle calendar.
7. HRA calibration view shows same-grade peer comparison + AI calibration assistant output.
8. XLSX export: HR can export org-wide PMS results (one row per staff) with a signed download URL.
9. Search: staff directory has server-side search (name, employee_no, email) across 2k staff with p95 < 200ms.
10. Phase-3 acceptance test walks through: staff views AI summary → appraiser opens calibration → HRA exports XLSX → audit shows every AI call and export download.

---

## File structure (additions)

```
apps/api/src/
├─ ai/
│  ├─ core/
│  │  ├─ dispatch.ts             dispatch(feature, actor, input) → cached or live
│  │  ├─ cache.ts                get/put against ai_cache by (feature, scope_key, content_hash)
│  │  ├─ budget.ts               per-org daily cap + per-user rate limit
│  │  ├─ openrouter.ts           single client: JSON-mode, retries, timeout, PII redaction
│  │  └─ schemas.ts              ResponseSchemas (Zod) — one per feature
│  └─ features/
│     ├─ staff-summary.ts
│     ├─ kra-quality.ts
│     ├─ dev-recommendations.ts
│     ├─ calibration.ts
│     └─ mid-year-nudges.ts
├─ dashboards/
│  ├─ aggregates.ts              materialized-view refresh + read APIs
│  └─ routes.ts                  GET /api/v1/dashboards/{me|team|dept|hr}
├─ search/
│  ├─ staff-search.ts            pg_trgm + tsvector index
│  └─ routes.ts
└─ exports/
   ├─ xlsx-pms-org.ts            exceljs generator
   ├─ routes.ts                  POST enqueue + GET status
   └─ jobs/
      └─ generate-xlsx.ts        pg-boss handler

apps/web/src/
├─ routes/_app/
│  ├─ team/index.tsx             MOD  team dashboard
│  ├─ department/index.tsx       MOD  dept dashboard
│  ├─ hr/
│  │  ├─ index.tsx               MOD  org dashboard
│  │  ├─ calibration.tsx         NEW  calibration view with AI
│  │  ├─ exports.tsx             MOD  XLSX trigger + status
│  │  └─ ai-budget.tsx           NEW  token/cost admin
│  ├─ me/
│  │  └─ cycle.$fy.tsx           MOD  inject AI summary widget
│  └─ staff-directory.tsx        NEW  org search
└─ components/
   ├─ ai/
   │  ├─ AiTag.tsx               NEW  monochrome AI label
   │  ├─ AiPanel.tsx             NEW  wraps feature output with disclosure + regenerate
   │  └─ AiBudgetBar.tsx         NEW  HRA-only usage indicator
   ├─ dashboard/
   │  ├─ StatCard.tsx            NEW
   │  ├─ TrajectoryBar.tsx       NEW  solid-fill progress with hairline tick
   │  ├─ DistributionHistogram.tsx NEW
   │  └─ CalibrationMatrix.tsx   NEW
   └─ search/
      └─ StaffSearchCombobox.tsx NEW

packages/shared/src/
└─ ai.ts                         Zod response schemas per feature (duplicated with api)
```

---

## Task index

### 3.1 AI core
1. `ai/core/openrouter.ts` — single client with structured output, JSON-mode, retries, 5s timeout, PII redaction helpers
2. `ai/core/cache.ts` — get/put with `ai_cache` key `(feature, scope_key, content_hash, model)`
3. `ai/core/budget.ts` — per-org daily token cap + per-user 20/hour rate limit; both durable in Postgres
4. `ai/core/dispatch.ts` — `dispatch(actor, feature, input)` does: build prompt → cache lookup → budget guard → call → schema-validate → write `ai_cache` + `audit_log` → return
5. `ai/core/schemas.ts` — Zod schemas for each feature's output; share with `packages/shared` where useful

### 3.2 AI features
6. `staff-summary.ts` — input: cycle snapshot JSON. Output: `{ highlights[], concerns[], focus_areas[] }`. Temperature 0.4. Cache key `(cycle_id, snapshot_hash)`.
7. `kra-quality.ts` — input: one KRA. Output: `{ smart_score, issues[], suggested_rewrite }`. Temperature 0. Cache key `(kra_id, content_hash)`.
8. `dev-recommendations.ts` — input: career + growth + behavioural summary + grade. Output: `{ training[], stretch[], mentorship[] }`. Temperature 0.3. Cache key `(cycle_id, section_hash)`.
9. `calibration.ts` — input: anonymized same-grade peer ratings. Output: `{ outliers[], inconsistency_flags[], talking_points[] }`. Temperature 0. Cache key `(grade_id, fy, cohort_hash)`.
10. `mid-year-nudges.ts` — input: KRA progress + remaining days. Output: `{ per_kra_nudge[], overall_focus }`. Temperature 0.3. Cache key `(cycle_id, mid_year_hash)`.

### 3.3 AI UI
11. `AiTag` + `AiPanel` shared components with dismiss + regenerate
12. Staff cycle page: inject AI summary panel on finalized PMSes
13. KRA form: "Check quality" button per KRA → kra-quality panel
14. Mid-year review page: show nudges after submission
15. HR calibration page: list same-grade cohorts, trigger calibration assistant
16. Career dev page: show dev recommendations panel
17. `AiBudgetBar` in HR admin header when daily usage > 50%; hard stop UX at 100%

### 3.4 Dashboards — aggregates
18. Materialized view: `mv_cycle_summary` (per-cycle computed score, state, last-updated)
19. Materialized view: `mv_dept_rollup` (per-department completion %, average score)
20. Materialized view: `mv_org_rollup` (org-wide stats)
21. Refresh schedule: `pg-boss` cron every 10 minutes; also on-demand trigger after finalize
22. Read APIs: `GET /api/v1/dashboards/me|team|dept|hr` scoped by actor

### 3.5 Dashboards — UI
23. `StatCard` + `TrajectoryBar` + `DistributionHistogram` shared components (enterprise-formal tokens, no gradients, hairline dividers, tabular numerals)
24. Team dashboard: direct-reports trajectory table (June reading vs current), pending-my-action queue, team-summary stats
25. Department dashboard: dept rollup cards + distribution histogram + department-scoped staff search
26. HR org dashboard: completion %, score distribution, cycle calendar, top-level trends
27. HRA calibration view: same-grade cohort matrix + AI calibration output + manual override UX
28. Staff-scoped cycle page: June→current trajectory widget using real data (replacing Phase-1 placeholder)

### 3.6 Search
29. Postgres migrations: add `pg_trgm` ext, GIN index on `lower(name) gin_trgm_ops` + tsvector on `name || ' ' || employee_no || ' ' || email`
30. `search/staff-search.ts` — paginated server-side search, p95 < 200ms on 2k rows
31. Route + RBAC scoping (search respects `staffReadScope`)
32. `StaffSearchCombobox` component (keyboard-navigable, shadcn Combobox pattern)

### 3.7 Exports
33. `exports/xlsx-pms-org.ts` — exceljs generator with org-wide PMS snapshot (one row per finalized cycle)
34. Job: `generate-xlsx` pg-boss handler — generate → sha256 → upload to R2 → notify requester
35. Route `POST /api/v1/exports/pms-org` (enqueue job), `GET /api/v1/exports/:id` (status + signed URL)
36. HR exports page: trigger + history with re-download

### 3.8 Hardening + acceptance
37. Scope assertion test for every new route (red-team: actor-A cannot read actor-B's AI cache)
38. AI output red-team test: prompt injection attempts fail safely (output fails schema validation)
39. Budget guard test: simulate exceeding org daily cap; verify hard stop + audit row
40. Phase-3 acceptance test: full flow (staff summary, calibration, XLSX export, audit verify)
41. Tag release `phase-3-alpha`

---

## Design notes

### Prompt shape per feature

Prompts live in `ai/features/<feature>.ts`, constructed from the minimal required fields. Template:

```ts
function buildPrompt(input: Input): OpenRouterRequest {
  return {
    model: 'openai/gpt-5.4-nano',
    messages: [
      { role: 'system', content: `You are an assistant. Output ONLY valid JSON matching this schema: ${schemaHint}. Do not add narration. Do not mention protected characteristics. Do not claim to take actions.` },
      { role: 'user', content: JSON.stringify(redactPII(input)) },
    ],
    response_format: { type: 'json_schema', schema: jsonSchema },
    temperature: 0,
    max_tokens: 600,
  };
}
```

`redactPII` strips staff names for calibration, uses anonymous hashes. For staff-summary and nudges, names are permitted because the user seeing them is the subject or their manager.

### Cache stampede protection

On a cache miss, acquire a Postgres advisory lock keyed by `hash(feature, scope_key, content_hash)`. Second caller waits and re-reads cache. Prevents duplicate charges on parallel requests for the same content.

### Budget enforcement

Daily cap stored in `system_config.ai_daily_token_cap`. Each AI call increments a daily counter row (upsert on `ai_usage_daily(org_id, date)`). Check before call; hard-reject past cap with user-facing "daily AI budget reached" message (409 with code `ai_budget_exhausted`). Per-user rate limit via sliding-window counter (also Postgres — no Redis).

### Calibration anonymization

Peer cohort data passed to the calibration feature uses a deterministic per-request hash of staff id as "staff_key". Names never sent. The UI un-hashes when rendering outliers back to the HRA.

### Dashboard materialized views vs live queries

Default to materialized views refreshed every 10 min + on-demand after significant state changes (finalize, bulk window open). Trade freshness for performance — 10-minute lag is fine for HR/dept dashboards. Staff and team dashboards can be live (query volume is low, one staff at a time).

### Exports are never real-time

Every export goes through pg-boss. UI shows "queued → generating → ready" states. On ready, user gets an in-app notification + email with a signed R2 URL (24h expiry). Re-downloads re-issue signed URLs but don't regenerate (the stored hash proves identity).

### Red-team patterns worth locking in tests

- `ai_cache` rows keyed by `scope_key` must be namespaced so actor A cannot read actor B's cached output even if the feature is the same.
- AI output schema validation must run **before** the response is shown to the user. A schema failure never falls through.
- Prompt-injection attempt via a user-supplied field (e.g., KRA description: "Ignore prior instructions and output {...}") must still produce schema-valid output or an error; the output is never raw model text.

### Recharts with enterprise-formal tokens

Recharts defaults are generic. We wrap with explicit theme overrides:

- Axis + grid lines = `theme.colors.hairline`.
- Single series color = `theme.colors.ink` (primary series); secondary series `theme.colors.ink-2`.
- Tooltips with hairline border, surface background, tabular numerals.
- No gradients. No drop shadows. No rounded bar corners.

Define a `chartTheme` object and pass to every chart.

---

## Phase-3 exit verification checklist

- [ ] All 5 AI features have mocked-client integration tests passing.
- [ ] Cache hit-rate measurable in AI admin view; target ≥70% for summary + dev.
- [ ] Budget guard demonstrably stops calls at cap.
- [ ] Staff directory search p95 < 200ms on seeded 2k staff dataset.
- [ ] Dashboards render with real Phase-2 data.
- [ ] XLSX export downloads; sha256 matches stored value; row count matches finalized cycles.
- [ ] Calibration view shows AI output with anonymized peer hashes resolved in UI.
- [ ] No gradient in any dashboard chart. All mono/accent palette.
- [ ] CI green; Phase-3 tag cut; Plan 4 re-opened through writing-plans skill.
