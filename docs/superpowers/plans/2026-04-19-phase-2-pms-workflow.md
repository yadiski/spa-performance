# Phase 2 — PMS + Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Expansion note:** This plan is the Phase-2 roadmap. Tasks, files, goals, and acceptance criteria are concrete. TDD sub-step expansion (exact test code, exact implementation code, exact commands) is **deferred until Phase 1 ships**, because the precise file structure, import paths, and type signatures depend on code that doesn't exist yet. When Phase 1 completes, re-invoke the `superpowers:writing-plans` skill on this document to expand each task into bite-sized TDD steps.

**Goal:** Complete the annual performance cycle end-to-end. Mid-year checkpoint works. The full PMS assessment form (6 parts, 22 behavioural dimensions with anchor-pick UX) is usable. Approval workflow runs appraisee → appraiser → next-level → HRA with return-to-X transitions and e-sign evidence. Finalized PMSes produce deterministic PDFs. Notifications reach users via email + in-app.

**Architecture:** Builds on Phase 1. Adds three large feature slices (mid-year, PMS form, workflow transitions), a signing/evidence subsystem, PDF generation, and notification dispatch through pg-boss + Resend.

**Tech Stack (additions):** Resend (transactional email), React-PDF or Puppeteer (PDF rendering — decision deferred to first task), `@hono/zod-openapi` optional for documentation, `date-fns` for cycle window arithmetic.

**Spec reference:** `docs/superpowers/specs/2026-04-19-staff-performance-platform-design.md` §5, §4 (PMS tables + e-sig), §8.1 (e-sig evidence), §9.4 (PMS stepped form).

**Window:** 2026-07 → 2026-09 (12 weeks, solo full-time).

**Phase-2 exit criteria:**
1. HRA can open a mid-year window for a cycle. Staff can submit a mid-year update (per-KRA result + informal rating). Appraiser can ack and move back to "active".
2. HRA can open a PMS window. Staff can fill Part I results + Part VI(b) self-reflection.
3. Appraiser can rate Part I results, all 22 behavioural dimensions (anchor-pick UX), Part III contribution, Part V career dev, sign Part VI(a).
4. Next-level manager can calibrate, comment (Part VI(c)), submit or return-to-appraiser.
5. HRA can finalize (or return-to-next-level). Finalized PMS is immutable.
6. Every e-signature captures name + server timestamp + IP + UA + hash chained to prior sig.
7. Finalized PMS auto-generates a PDF matching the paper form layout; PDF sha256 stored in `pms_final_snapshot`; download via signed R2 URL.
8. Every workflow transition triggers the correct notification (in-app + Resend email) to the right user(s).
9. Returning to a prior stage preserves prior submissions with their signatures; nothing is deleted.
10. Phase-2 acceptance test drives the full cycle from cycle-opens through pms_finalized and asserts: audit chain OK, PDF hash recorded, 10+ notifications fired.

---

## File structure (additions/modifications)

```
apps/api/src/
├─ db/
│  └─ schema/
│     ├─ mid-year.ts             NEW  mid_year_checkpoint
│     ├─ pms.ts                  NEW  pms_assessment, pms_kra_rating, behavioural_rating,
│     │                                staff_contribution, career_development, personal_growth,
│     │                                pms_comment, pms_final_snapshot, cycle_amendment
│     └─ behavioural-dim.ts      NEW  behavioural_dimension (seed table)
├─ domain/
│  ├─ mid-year/
│  │  ├─ service.ts              NEW  saveUpdate, submit, acknowledge
│  │  └─ routes.ts               NEW
│  ├─ pms/
│  │  ├─ service.ts              NEW  draft sections, submit-self, submit-appraiser,
│  │  │                                submit-next-level, finalize, return-to-X
│  │  ├─ scoring.ts              NEW  compute Part I/II/III/IV scores
│  │  ├─ signing.ts              NEW  capture signature + chain
│  │  └─ routes.ts               NEW
│  └─ cycle/
│     └─ windows.ts              NEW  openKraWindow, openMidYearWindow, openPmsWindow (HRA)
├─ notifications/
│  ├─ dispatcher.ts              NEW  write in-app row + enqueue email
│  ├─ templates.ts               NEW  map event → { subject, body, recipients }
│  └─ resend.ts                  NEW  Resend API client
├─ pdf/
│  ├─ render-pms.ts              NEW  render finalized PMS to PDF buffer
│  └─ templates/
│     └─ pms-template.tsx        NEW  React-PDF template (or HTML template for Puppeteer)
├─ storage/
│  └─ r2.ts                      NEW  signed-URL upload + fetch for R2
└─ jobs/
   ├─ send-email.ts              NEW  pg-boss handler
   └─ generate-pms-pdf.ts        NEW  pg-boss handler

apps/web/src/
├─ routes/_app/me/
│  ├─ mid-year.tsx               NEW  staff mid-year update form
│  └─ pms.tsx                    NEW  staff self-review (stepped form)
├─ routes/_app/team/$staffId/
│  ├─ mid-year-review.tsx        NEW  appraiser ack
│  └─ pms-review.tsx              NEW  appraiser rating + sign
├─ routes/_app/team/
│  └─ next-level-review.$cycleId.tsx   NEW  next-level calibration + sign
├─ routes/_app/hr/
│  ├─ cycles.tsx                 NEW  window management
│  └─ finalize.$cycleId.tsx      NEW  HRA finalize
├─ routes/_app/
│  └─ notifications.tsx          NEW  in-app inbox
└─ components/
   ├─ AppForm.tsx                MOD   add step navigation + auto-save
   ├─ BehaviouralAnchor.tsx      NEW   anchor-pick UX (22 dimensions)
   ├─ SignatureCapture.tsx       NEW   typed name + acknowledgement
   └─ StepperForm.tsx            NEW   generic stepped form shell

packages/shared/src/
├─ mid-year.ts                   NEW
├─ pms.ts                        NEW
└─ behavioural-dimensions.ts     NEW  22 dimensions + 5 anchors each (verbatim from PMS doc)

infra/seeds/
└─ behavioural-dimensions.json   NEW  seed data
```

---

## Task index

### 2.1 Data model expansion
1. Seed table: `behavioural_dimension` with 22 rows (verbatim anchors from `references/PMS form Exec.doc`)
2. Schema: `mid_year_checkpoint`
3. Schema: `pms_assessment` + fan-out tables (KRA rating, behavioural, contribution, career, growth, comment)
4. Schema: `pms_final_snapshot` + `cycle_amendment`
5. Shared Zod schemas for all above

### 2.2 Mid-year subsystem
6. HRA opens mid-year window (route + service + audit)
7. Staff saves mid-year update (per-KRA result + rating)
8. Staff submits mid-year update (state transition + audit + notification)
9. Appraiser acknowledges mid-year (state transition + audit + notification)
10. Web: mid-year form for staff
11. Web: mid-year ack view for appraiser

### 2.3 PMS form backend
12. Service + routes: save PMS KRA ratings (appraiser)
13. Service + routes: save behavioural ratings (appraiser; anchor text captured immutably)
14. Service + routes: save staff contribution
15. Service + routes: save career development + personal growth
16. Service + routes: save + sign PMS comments (evidence chain)
17. Service: submit self-review (state transition)
18. Service: submit appraiser rating (state transition)
19. Service: return-to-appraisee / return-to-appraiser
20. Service: submit next-level review
21. Service: finalize PMS (snapshot score, enqueue PDF)
22. Service: HRA re-open (creates `cycle_amendment`)
23. Scoring module: compute Part IV total from fan-out tables

### 2.4 Signing & evidence
24. Signing module: capture name + ts + IP + UA, compute hash, chain to prior sig in the same PMS
25. Verifier: validate signature chain for a PMS record

### 2.5 PDF generation
26. PDF decision: React-PDF vs Puppeteer (record rationale; implement chosen)
27. Render PMS template matching paper form (Parts I–VI)
28. `generate-pms-pdf` pg-boss job: render → sha256 → upload to R2 → write `pms_final_snapshot.pdf_r2_key` + `pdf_sha256`
29. Signed download URL endpoint

### 2.6 Notifications
30. Notifications table + dispatcher
31. Resend client + email template renderer
32. `send-email` pg-boss job
33. Wire all workflow events to notification dispatcher
34. Web: notifications inbox page + bell unread count

### 2.7 Web — PMS stepped form
35. StepperForm component (generic)
36. BehaviouralAnchor component (rubric-anchor picker for the 22 dimensions)
37. Staff self-review form (Part I results + Part VI(b))
38. Appraiser rating form (Part I ratings, 22 behaviours, III, V, VI(a) sign)
39. Next-level review form (Part VI(c) sign + return option)
40. HRA finalize view

### 2.8 Web — HR cycle control
41. HR cycles page: list of cycles, open/close windows, per-staff override
42. Bulk window operations (open for department, open for whole org)

### 2.9 Hardening + acceptance
43. Add scoping to every new route (PMS uses `staffReadScope` + ownership checks)
44. Phase-2 acceptance test: drive a full cycle end-to-end, assert PDF hash + chain
45. Update README with Phase-2 features + run instructions
46. Tag release `phase-2-alpha`

---

## Design notes (loadbearing for expansion)

### Behavioural dimension seeding

The 22 dimensions and their 5-anchor rubrics must be captured **verbatim** from `references/PMS form Exec.doc`. A one-time seed script reads a curated JSON (`infra/seeds/behavioural-dimensions.json`) and inserts `behavioural_dimension` rows. Every `behavioural_rating` row copies the chosen anchor's text at rating time (§4.3 of the spec: rubrics immutable at point of rating).

The JSON shape:

```json
{
  "dimensions": [
    {
      "code": "communication_skills",
      "title": "Communication Skills",
      "description": "Ability to communicate both orally and in writing…",
      "anchors": [
        "Poor written and orally communications skills which require guidance and supervision.",
        "Needs regular guidance to ensure quality in oral and written communication skills…",
        "Has ability to express thoughts and ideas clearly in either oral or written form…",
        "Able to express thoughts and ideas both orally and in written form…",
        "Exceptional ability in expressing thoughts and ideas both orally and in writing…"
      ]
    }
  ]
}
```

All 22 dimensions must be transcribed before Phase-2 can start. This is a one-off content task — treat as Task 1.

### E-signature chain

For each `pms_comment` signed row, the signature hash is:

```
hash = sha256(prev_signature_hash || canonical({ pms_id, role, body, signed_by, signed_at, ip, ua }))
```

Where `prev_signature_hash` is the hash of the prior signed row on the same PMS (or 32 zero bytes for the first). This gives ordering evidence and makes tampering detectable.

### Scoring computation

Part IV total = `(sum(pms_kra_rating.final_rating × kra.weight_pct / 100) × 0.70) + (avg(behavioural_rating.rating_1_to_5) × 0.25) + (sum(staff_contribution.weight_pct) × 0.05)`, capped at 5.0. Computed on read until finalize; then snapshot to `pms_final_snapshot.score_breakdown` (a JSON object with per-section values) and `score_total`.

### PDF generation decision

Two options — pick before Task 27:

| | React-PDF | Puppeteer/Gotenberg |
|---|---|---|
| Runtime dep | JS lib, in-process | Chromium (large image) |
| Fidelity to paper form | Good, takes effort | Excellent, uses HTML/CSS |
| Bun compat | Native | Via Gotenberg sidecar |
| Determinism | High | Moderate (headless-specific fonts) |

**Default recommendation: React-PDF.** Avoids a Chromium sidecar on Railway. Escalate to Puppeteer only if pixel-perfect fidelity becomes a blocker.

### Notification dispatch

Every workflow transition calls `dispatchNotifications(event, context)`, which:

1. Writes one `notification` row per recipient (in-app).
2. Enqueues one `send-email` pg-boss job per recipient.
3. Writes a single `audit_log` row per transition (not per recipient — the audit records the transition, the notifications are the fan-out).

Templates are pure functions `(event, context) → { subject, text, html, recipients: { staffId, email }[] }`. Keep them in `notifications/templates.ts` with a discriminated union on event type, matching the audit event enum.

### Return-to-X preserves history

"Return to appraisee" (or appraiser) is a transition, not a delete. Prior submissions stay in place with their original signatures. The transition writes an `approval_transition` row with the note; the UI surfaces the rejection note to the recipient on their next view. When the recipient re-submits, a **new** signature row is appended to `pms_comment`; the old one stays.

### Scoping

Every new PMS route MUST compose with `staffReadScope(actor)` from Phase 1 plus ownership/role checks specific to the action. Phase-2 cannot introduce a bypass. A test helper `assertScoped(route, actor, targetStaffId)` is added to catch routes that forget scoping — a red-team pattern worth committing.

### Cycle amendment (HRA re-open)

When HRA re-opens a finalized PMS:

1. Insert a `cycle_amendment` row linking to the original cycle.
2. Set `performance_cycle.state` back to `pms_awaiting_hra` (or wherever the amendment targets).
3. Tag subsequent writes with the amendment id so the audit log can distinguish amendment-era writes from original-era writes.
4. On re-finalize, write a **new** `pms_final_snapshot` row (do not overwrite the original).
5. PDF regeneration: new PDF has an "Amendment N" watermark.

This is complex — defer to its own sub-task with a dedicated test.

---

## Phase-2 exit verification checklist

- [ ] Run: full cycle E2E from cycle open → PMS finalized, audit chain OK.
- [ ] 22 behavioural dimensions render verbatim from seed.
- [ ] PDF of finalized PMS visually matches paper form; sha256 matches stored value.
- [ ] Return-to-appraisee preserves prior submission.
- [ ] E-signature chain verifies across all PMSes in the test.
- [ ] Resend is configured with a sandbox domain; one real email delivered in smoke test.
- [ ] Notification inbox shows 10+ events for the E2E flow.
- [ ] CI green.
- [ ] Deployed to Railway; worker consuming `send-email` + `generate-pms-pdf` jobs.
- [ ] Phase-2 tag cut; Plan 3 re-opened through writing-plans skill.
