# Staff Performance Platform

Monorepo for Payong-Legam's performance management system. Bun workspaces, Hono API, Vite + React web, Drizzle + Postgres, pg-boss, Cloudflare R2, Resend.

## Phase status

- **Phase 1 (foundation):** complete. Auth, org/staff import, cycle state machine, KRA workflow, audit log chain, daily anchor job.
- **Phase 2 (PMS workflow):** complete as of `5dad6be`. Mid-year checkpoint, full PMS form (Parts I–VI with 22 behavioural rubrics), e-signature chain, React-PDF generation + R2 upload, notification fan-out (in-app + email via Resend), HR cycle control, end-to-end acceptance test.

See `docs/superpowers/plans/` for the per-phase plan documents and exit checklists.

## What Phase 2 shipped

- Mid-year checkpoint: HRA opens, staff saves + submits per-KRA progress + rating, appraiser acknowledges.
- PMS form backend: per-KRA ratings, 22 behavioural dimensions (verbatim-immutable anchor text), staff contributions, career development, personal growth, signed comments.
- State machine transitions: self-review submit, appraiser submit, next-level submit, return-to-appraisee/appraiser, HRA finalize, HRA re-open (with cycle_amendment).
- E-signature chain on `pms_comment` — each signed row hashes the prior signature; verifier at `GET /api/v1/pms/:cycleId/verify-signatures`.
- Scoring: Part IV total = (Σ KRA rating × weight × 0.70) + (avg behavioural × 0.25) + (Σ contribution weight × 0.05), capped at 5.0. Snapshot persisted on finalize.
- PDF generation via React-PDF in a pg-boss job. Output uploaded to Cloudflare R2, sha256 stamped on the snapshot row, 24h presigned download URL via `GET /api/v1/pms/:cycleId/pdf`.
- Notifications: `notification` table, pure-function templates, Resend client, `notifications.send_email` pg-boss job, dispatcher fires on every workflow transition, web inbox at `/notifications` with bell counter in the header.
- Web forms: role-scoped stepper forms for staff self-review, appraiser rating (with 22 BehaviouralAnchor pickers), next-level review, HRA finalize. HR cycles list with per-staff and bulk window controls.
- Red-team scoping test plus Phase-2 acceptance test that drives the full cycle and asserts PDF hash + signature chain + audit chain.

## Running locally

### Prerequisites

- Bun 1.3+
- Postgres 16 running on `localhost:5432` with a `postgres` superuser
- An R2 bucket + credentials (optional — PDF generation will error without, but everything else works)
- A Resend API key + verified from-address (optional — email send fails without, in-app notifications still work)

### First-time setup

```bash
bun install

# Create local databases
createdb -h 127.0.0.1 -p 5432 -U postgres spa        # dev
createdb -h 127.0.0.1 -p 5432 -U postgres spa_test   # tests

# Copy .env.example → .env.local and fill in values
cp .env.example .env.local
# Required: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, API_PORT, WEB_ORIGIN
# Optional: R2_*, RESEND_API_KEY, RESEND_FROM_EMAIL

# Apply migrations + seed behavioural dimensions into dev DB
cd apps/api
DATABASE_URL="<dev-db-url>" bunx drizzle-kit push
bun src/scripts/seed-behavioural-dims.ts
bun src/scripts/seed-malaysian-org.ts   # optional demo org
```

The test harness applies migrations + seeds `spa_test` automatically on first `bun test` run — nothing manual needed.

### Day-to-day

```bash
# API
cd apps/api && bun run dev           # http://localhost:3000

# Worker (pg-boss jobs: daily audit anchor, generate-pms-pdf, send-email)
cd apps/api && bun run worker

# Web
cd apps/web && bun run dev           # http://localhost:5173

# Tests (from repo root)
bun test

# Typecheck
cd apps/api && bun run typecheck
cd apps/web && bun run typecheck

# Lint / format
bunx biome check .
bunx biome check --write .
```

### Deployment

Railway hosts three services: `api`, `worker`, and Postgres. See `infra/railway.md`. R2 bucket is `spa-performance-prod`; credentials live in Railway env vars.

## Repo layout

```
apps/
  api/                 Hono API + pg-boss worker
    src/
      db/              Drizzle schema + migrations
      domain/          Feature modules (cycle, kra, mid-year, pms, notifications, staff)
      http/            Route mounting + error handler
      jobs/            pg-boss job handlers + queue client
      notifications/   Resend client
      storage/         R2 client
      pdf/             React-PDF renderer + templates
      audit/           Hash chain, anchor job
      auth/            better-auth middleware
      rbac/            staffReadScope + role helpers
    test/              bun:test; setup.ts applies migrations to spa_test
  web/                 Vite + React 19 + TanStack Router/Query/Form
    src/
      api/             Typed fetch wrappers per domain
      components/      Shared UI (AppShell, StepperForm, BehaviouralAnchor, NotificationBell)
      routes/          File-based TanStack routes under _app/
packages/
  shared/              Zod schemas + enums consumed by both api and web
infra/
  seeds/               Behavioural dimensions JSON, sample staff CSV
  railway.md           Deployment notes
docs/
  superpowers/plans/   Per-phase implementation plans with task indexes
  superpowers/specs/   Platform design spec
```

## Key architectural decisions

- **Audit log is a hash chain.** Every write to `audit_log` includes `prev_hash` + `hash` + `chain_root`. A daily anchor job publishes the root so tampering after the fact is detectable. See `apps/api/src/audit/`.
- **Behavioural anchors are immutable at rating time.** `behavioural_rating.rubric_anchor_text` captures the exact anchor string at the moment the appraiser picks it; changing the seed later doesn't retroactively alter existing ratings.
- **PMS finalize snapshots the score.** Live computation until finalize; after that, `pms_final_snapshot.score_total` + `score_breakdown` are frozen. Re-open creates a `cycle_amendment` and writes a new snapshot rather than overwriting the original.
- **Notification dispatcher runs inside the transition tx.** `dispatchNotifications(tx, input)` writes `notification` rows in the same tx as the state change + audit. Email enqueue via `boss.send` uses pg-boss's own connection, so a tx rollback leaves the email already queued — rare, detectable via audit/notification divergence, documented in `apps/api/src/domain/notifications/dispatch.ts`.
- **staffReadScope + ownership checks on every scoped route.** Test `apps/api/test/scoping-red-team.test.ts` hits every mutating endpoint as an outsider and asserts 401 / 403 to catch regressions.
