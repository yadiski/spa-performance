# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working monorepo running on Railway with Better Auth, Drizzle+Postgres, hash-chained audit log, RBAC scoping, staff/hierarchy data, and an end-to-end KRA goal-setting flow (draft → approve → reject) behind a minimal staff dashboard.

**Architecture:** Bun monorepo with three services on Railway (`web` static SPA, `api` Hono HTTP, `worker` shared-codebase job consumer) plus managed Postgres. Shared Zod schemas cross the FE/BE boundary via `packages/shared`. Audit writes are co-transactional with every domain mutation; the audit table is append-only and hash-chained.

**Tech Stack:** Bun, Hono, Drizzle ORM, PostgreSQL 16, Better Auth, pg-boss, Vite, React 19, TanStack Router, TanStack Query, TanStack Form, TanStack Table, shadcn/ui, Tailwind, Zod, Biome.

**Spec reference:** `docs/superpowers/specs/2026-04-19-staff-performance-platform-design.md`

**Window:** 2026-04 → 2026-06 (12 weeks, solo full-time).

**Phase-1 exit criteria:**
1. Staff can log in with email/password + TOTP.
2. HRA can import staff + hierarchy from CSV.
3. HRA can open a KRA-drafting window for a cycle.
4. Staff can draft 3–5 KRAs totalling 100%, submit for approval.
5. Appraiser can approve or reject (with note).
6. Audit log captures every state change and can be verified via chain check.
7. Deployed on Railway (web + api + worker + db).
8. CI runs Bun test + typecheck + lint + migration dry-run on every PR.

---

## File Structure

```
spa-performance/
├─ package.json                       Bun workspaces root
├─ tsconfig.base.json                 Shared TS config
├─ biome.json                         Lint + format
├─ .gitignore
├─ .env.example
├─ README.md
├─ .github/workflows/ci.yml           Test + typecheck + lint
│
├─ apps/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ drizzle.config.ts
│  │  ├─ src/
│  │  │  ├─ index.ts                  Hono app entry
│  │  │  ├─ worker.ts                 pg-boss worker entry
│  │  │  ├─ env.ts                    Zod-validated env
│  │  │  ├─ db/
│  │  │  │  ├─ client.ts              Drizzle client singleton
│  │  │  │  ├─ schema/
│  │  │  │  │  ├─ auth.ts             Better Auth tables
│  │  │  │  │  ├─ org.ts              organization, department, grade
│  │  │  │  │  ├─ staff.ts            staff + manager hierarchy
│  │  │  │  │  ├─ cycle.ts            performance_cycle, kra, kra_progress_update
│  │  │  │  │  ├─ audit.ts            audit_log, audit_anchor
│  │  │  │  │  └─ index.ts            schema barrel
│  │  │  │  └─ migrations/            drizzle-kit output
│  │  │  ├─ auth/
│  │  │  │  ├─ better-auth.ts         Better Auth config (Drizzle adapter)
│  │  │  │  └─ middleware.ts          Hono auth middleware (attaches actor)
│  │  │  ├─ audit/
│  │  │  │  ├─ log.ts                 writeAudit(tx, event) — inside txn
│  │  │  │  ├─ hash.ts                canonicalJson + sha256 chain
│  │  │  │  └─ verifier.ts            verifyChain(from, to)
│  │  │  ├─ rbac/
│  │  │  │  ├─ roles.ts               Role enum + permission registry
│  │  │  │  ├─ scope.ts               scopedQuery(actor, entity) wrapper
│  │  │  │  └─ hierarchy.ts           directReports, transitiveReports CTEs
│  │  │  ├─ domain/
│  │  │  │  ├─ staff/
│  │  │  │  │  ├─ service.ts
│  │  │  │  │  └─ routes.ts
│  │  │  │  ├─ cycle/
│  │  │  │  │  ├─ state-machine.ts    transitions table + validate()
│  │  │  │  │  ├─ service.ts
│  │  │  │  │  └─ routes.ts
│  │  │  │  └─ kra/
│  │  │  │     ├─ service.ts          draft/submit/approve/reject
│  │  │  │     └─ routes.ts
│  │  │  ├─ http/
│  │  │  │  ├─ app.ts                 Hono app assembly
│  │  │  │  ├─ error.ts               Error handler + stable codes
│  │  │  │  └─ rate-limit.ts          Per-user/per-IP limiter
│  │  │  └─ jobs/
│  │  │     ├─ queue.ts               pg-boss client
│  │  │     └─ daily-audit-anchor.ts  cron: daily audit_anchor row
│  │  └─ test/
│  │     ├─ setup.ts                  test DB bootstrap
│  │     ├─ fixtures.ts               seed users + staff
│  │     ├─ helpers.ts                tx rollback wrapper
│  │     ├─ audit.test.ts
│  │     ├─ rbac-scope.test.ts
│  │     ├─ hierarchy.test.ts
│  │     ├─ cycle-state-machine.test.ts
│  │     ├─ kra-service.test.ts
│  │     └─ kra-routes.test.ts
│  │
│  └─ web/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ vite.config.ts
│     ├─ index.html
│     ├─ tailwind.config.ts
│     ├─ src/
│     │  ├─ main.tsx
│     │  ├─ app.tsx                   Router provider
│     │  ├─ router.tsx                TanStack Router config
│     │  ├─ api/
│     │  │  ├─ client.ts              Typed fetch wrapper
│     │  │  └─ queries.ts             TanStack Query keys + hooks
│     │  ├─ auth/
│     │  │  └─ client.ts              Better Auth React client
│     │  ├─ components/
│     │  │  ├─ ui/                    shadcn primitives (generated)
│     │  │  ├─ AppShell.tsx           Sidebar + topbar + outlet
│     │  │  ├─ ProgressBar.tsx        Solid fill + hairline tick
│     │  │  ├─ DataTable.tsx          TanStack Table wrapper
│     │  │  └─ AppForm.tsx            TanStack Form + Zod wrapper
│     │  ├─ routes/
│     │  │  ├─ __root.tsx
│     │  │  ├─ _auth/
│     │  │  │  ├─ login.tsx
│     │  │  │  └─ mfa.tsx
│     │  │  └─ _app/
│     │  │     ├─ index.tsx           role redirect
│     │  │     ├─ me/
│     │  │     │  ├─ index.tsx        staff dashboard
│     │  │     │  └─ kra.tsx          KRA form
│     │  │     └─ team/
│     │  │        └─ kra-approve.$staffId.tsx
│     │  └─ styles/
│     │     └─ globals.css            Tailwind + tokens
│     └─ test/
│        ├─ setup.ts
│        └─ smoke.test.ts
│
├─ packages/
│  └─ shared/
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ index.ts                  barrel
│        ├─ enums.ts                  KraPerspective, CycleState, Role
│        ├─ kra.ts                    Zod: KraDraft, KraCreate, KraApprove
│        ├─ cycle.ts                  Zod: CycleOpen, CycleState transitions
│        └─ audit.ts                  Zod: AuditEvent (discriminated union)
│
└─ infra/
   ├─ railway.json                    Service definitions
   └─ seeds/
      └─ sample-staff.csv
```

---

## Task index

1. Monorepo + tooling scaffold
2. Shared package with initial Zod schemas + enums
3. Bootstrap `api` with Hono hello-world + env validation
4. Bootstrap `web` with Vite + React + TanStack Router skeleton
5. Bootstrap test harness for `api` + `web`
6. Drizzle config + first migration: organization, department, grade
7. Better Auth integration (email+password + TOTP) with Drizzle adapter
8. Staff table + manager hierarchy + recursive CTE helpers
9. Audit log: schema + append-only trigger + hash chain helper
10. Hono auth middleware + actor attachment
11. RBAC role/permission registry + scopedQuery wrapper
12. Performance cycle table + state-machine module
13. KRA + KRA progress update tables + KRA service (draft/submit/approve/reject)
14. KRA routes + integration tests
15. Daily audit-anchor cron job
16. Web: Better Auth client + login + MFA flow
17. Web: app shell (sidebar, topbar, role-based redirect)
18. Web: staff dashboard index + cycle-status widget (empty state)
19. Web: KRA form (TanStack Form, weight-total validator, draft autosave, submit)
20. Web: appraiser KRA approval page
21. Bulk staff + hierarchy CSV import (HRA-only)
22. Railway deployment config + smoke deploy
23. CI pipeline (GitHub Actions)
24. Phase-1 acceptance test (end-to-end)

---

## Task 1: Monorepo + tooling scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Initialize git + create root package.json**

Run:

```bash
git init
bun init -y
```

Replace the generated `package.json` with:

```json
{
  "name": "spa-performance",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "build": "bun run --filter '*' build",
    "test": "bun test",
    "typecheck": "bun run --filter '*' typecheck",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Create shared TS config**

Write `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["bun-types"]
  },
  "exclude": ["node_modules", "dist", "build"]
}
```

- [ ] **Step 3: Create Biome config**

Write `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "useImportType": "error" },
      "suspicious": { "noExplicitAny": "error" },
      "correctness": { "useExhaustiveDependencies": "error" }
    }
  },
  "javascript": {
    "formatter": { "quoteStyle": "single", "semicolons": "always", "trailingCommas": "all" }
  },
  "files": { "ignore": ["dist", "build", "node_modules", "**/drizzle/**"] }
}
```

- [ ] **Step 4: Create .gitignore**

Write `.gitignore`:

```
node_modules
dist
build
.env
.env.local
*.log
.DS_Store
.superpowers/
/tmp/
coverage/
.turbo/
```

- [ ] **Step 5: Create .env.example**

Write `.env.example`:

```
# Postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/spa

# Better Auth
BETTER_AUTH_SECRET=change-me-32-chars-minimum
BETTER_AUTH_URL=http://localhost:3000

# Resend (phase 2)
RESEND_API_KEY=

# Cloudflare R2 (phase 2)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

# OpenRouter (phase 3)
OPENROUTER_API_KEY=

# Runtime
NODE_ENV=development
API_PORT=3000
WEB_ORIGIN=http://localhost:5173
```

- [ ] **Step 6: Install root deps + verify**

Run:

```bash
bun install
bun run lint
```

Expected: lint passes (no files yet).

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: monorepo scaffold with bun workspaces, biome, tsconfig"
```

---

## Task 2: Shared package with initial Zod schemas + enums

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/enums.ts`
- Create: `packages/shared/src/kra.ts`
- Create: `packages/shared/src/cycle.ts`
- Create: `packages/shared/src/audit.ts`
- Test: `packages/shared/test/schemas.test.ts`

- [ ] **Step 1: Create package**

Write `packages/shared/package.json`:

```json
{
  "name": "@spa/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

Write `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write enums**

Write `packages/shared/src/enums.ts`:

```ts
export const Role = {
  Staff: 'staff',
  Appraiser: 'appraiser',
  NextLevel: 'next_level',
  DepartmentHead: 'department_head',
  HrManager: 'hr_manager',
  Hra: 'hra',
  ItAdmin: 'it_admin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const KraPerspective = {
  Financial: 'financial',
  Customer: 'customer',
  InternalProcess: 'internal_process',
  LearningGrowth: 'learning_growth',
} as const;
export type KraPerspective = (typeof KraPerspective)[keyof typeof KraPerspective];

export const CycleState = {
  KraDrafting: 'kra_drafting',
  KraPendingApproval: 'kra_pending_approval',
  KraApproved: 'kra_approved',
  MidYearOpen: 'mid_year_open',
  MidYearSubmitted: 'mid_year_submitted',
  MidYearDone: 'mid_year_done',
  PmsSelfReview: 'pms_self_review',
  PmsAwaitingAppraiser: 'pms_awaiting_appraiser',
  PmsAwaitingNextLevel: 'pms_awaiting_next_lvl',
  PmsAwaitingHra: 'pms_awaiting_hra',
  PmsFinalized: 'pms_finalized',
} as const;
export type CycleState = (typeof CycleState)[keyof typeof CycleState];
```

- [ ] **Step 3: Write KRA schemas**

Write `packages/shared/src/kra.ts`:

```ts
import { z } from 'zod';
import { KraPerspective } from './enums';

export const kraAnchors = z.array(z.string().min(1).max(500)).length(5);

export const kraDraft = z.object({
  id: z.string().uuid().optional(),
  perspective: z.nativeEnum(KraPerspective),
  description: z.string().min(10).max(2000),
  weightPct: z.number().int().min(1).max(100),
  measurement: z.string().min(5).max(1000),
  target: z.string().min(1).max(500),
  order: z.number().int().min(0),
  rubric1to5: kraAnchors,
});
export type KraDraft = z.infer<typeof kraDraft>;

export const kraCreateBatch = z.object({
  cycleId: z.string().uuid(),
  kras: z.array(kraDraft).min(3).max(5),
}).refine(
  (v) => v.kras.reduce((s, k) => s + k.weightPct, 0) === 100,
  { message: 'KRA weights must total 100%' },
);
export type KraCreateBatch = z.infer<typeof kraCreateBatch>;

export const kraApprove = z.object({
  cycleId: z.string().uuid(),
});
export type KraApprove = z.infer<typeof kraApprove>;

export const kraReject = z.object({
  cycleId: z.string().uuid(),
  note: z.string().min(3).max(2000),
});
export type KraReject = z.infer<typeof kraReject>;
```

- [ ] **Step 4: Write cycle schema**

Write `packages/shared/src/cycle.ts`:

```ts
import { z } from 'zod';
import { CycleState } from './enums';

export const openCycle = z.object({
  staffId: z.string().uuid(),
  fy: z.number().int().min(2000).max(2100),
});
export type OpenCycle = z.infer<typeof openCycle>;

export const cycleTransition = z.object({
  from: z.nativeEnum(CycleState),
  to: z.nativeEnum(CycleState),
  note: z.string().max(2000).optional(),
});
export type CycleTransition = z.infer<typeof cycleTransition>;
```

- [ ] **Step 5: Write audit event schema**

Write `packages/shared/src/audit.ts`:

```ts
import { z } from 'zod';

const base = z.object({
  ts: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  actorRole: z.string().nullable(),
  ip: z.string().nullable(),
  ua: z.string().nullable(),
});

export const auditEvent = z.discriminatedUnion('type', [
  base.extend({
    type: z.literal('cycle.opened'),
    target: z.object({ cycleId: z.string().uuid(), staffId: z.string().uuid(), fy: z.number() }),
  }),
  base.extend({
    type: z.literal('kra.drafted'),
    target: z.object({ cycleId: z.string().uuid() }),
    payload: z.object({ count: z.number(), totalWeight: z.number() }),
  }),
  base.extend({
    type: z.literal('kra.submitted'),
    target: z.object({ cycleId: z.string().uuid() }),
  }),
  base.extend({
    type: z.literal('kra.approved'),
    target: z.object({ cycleId: z.string().uuid() }),
  }),
  base.extend({
    type: z.literal('kra.rejected'),
    target: z.object({ cycleId: z.string().uuid() }),
    payload: z.object({ note: z.string() }),
  }),
  base.extend({
    type: z.literal('auth.login.success'),
    target: z.object({ userId: z.string().uuid() }),
  }),
  base.extend({
    type: z.literal('auth.login.failure'),
    target: z.object({ email: z.string() }),
    payload: z.object({ reason: z.string() }),
  }),
]);
export type AuditEvent = z.infer<typeof auditEvent>;
```

- [ ] **Step 6: Write index barrel**

Write `packages/shared/src/index.ts`:

```ts
export * from './enums';
export * from './kra';
export * from './cycle';
export * from './audit';
```

- [ ] **Step 7: Write failing test**

Write `packages/shared/test/schemas.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { kraCreateBatch, CycleState, Role } from '../src/index';

describe('kraCreateBatch', () => {
  const validKra = {
    perspective: 'financial' as const,
    description: 'Deliver systems on time and within cost envelope.',
    weightPct: 25,
    measurement: 'Milestone tracking + vendor CRs.',
    target: '100% completion',
    order: 0,
    rubric1to5: ['r1', 'r2', 'r3', 'r4', 'r5'],
  };

  it('accepts 4 KRAs totalling 100%', () => {
    const result = kraCreateBatch.safeParse({
      cycleId: '11111111-1111-1111-1111-111111111111',
      kras: [
        { ...validKra, weightPct: 25 },
        { ...validKra, weightPct: 25, order: 1 },
        { ...validKra, weightPct: 25, order: 2 },
        { ...validKra, weightPct: 25, order: 3 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects weights that do not total 100%', () => {
    const result = kraCreateBatch.safeParse({
      cycleId: '11111111-1111-1111-1111-111111111111',
      kras: [
        { ...validKra, weightPct: 50 },
        { ...validKra, weightPct: 40, order: 1 },
        { ...validKra, weightPct: 5, order: 2 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects fewer than 3 KRAs', () => {
    const result = kraCreateBatch.safeParse({
      cycleId: '11111111-1111-1111-1111-111111111111',
      kras: [{ ...validKra, weightPct: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it('exposes enum values', () => {
    expect(Role.Hra).toBe('hra');
    expect(CycleState.KraDrafting).toBe('kra_drafting');
  });
});
```

- [ ] **Step 8: Install deps + run tests**

Run:

```bash
bun install
bun test packages/shared
```

Expected: all 4 tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): zod schemas + enums for KRA, cycle, audit, role"
```

---

## Task 3: Bootstrap `api` with Hono hello-world + env validation

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/http/app.ts`
- Create: `apps/api/src/http/error.ts`
- Create: `apps/api/src/index.ts`
- Test: `apps/api/test/env.test.ts`
- Test: `apps/api/test/health.test.ts`

- [ ] **Step 1: Create api package**

Write `apps/api/package.json`:

```json
{
  "name": "@spa/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "worker": "bun src/worker.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@spa/shared": "workspace:*",
    "hono": "^4.6.11",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/bun": "latest"
  }
}
```

Write `apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "outDir": "dist" },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 2: Write failing env test**

Write `apps/api/test/env.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { loadEnv } from '../src/env';

describe('loadEnv', () => {
  it('parses valid env', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      BETTER_AUTH_URL: 'http://localhost:3000',
      NODE_ENV: 'test',
      API_PORT: '3000',
      WEB_ORIGIN: 'http://localhost:5173',
    });
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.API_PORT).toBe(3000);
  });

  it('rejects short secret', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://u:p@localhost:5432/db',
        BETTER_AUTH_SECRET: 'short',
        BETTER_AUTH_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
        API_PORT: '3000',
        WEB_ORIGIN: 'http://localhost:5173',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run test to confirm failure**

Run: `bun test apps/api/test/env.test.ts`
Expected: FAIL — cannot import `loadEnv`.

- [ ] **Step 4: Implement env loader**

Write `apps/api/src/env.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgres'),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  API_PORT: z.coerce.number().int().min(1).max(65535),
  WEB_ORIGIN: z.string().url(),
  RESEND_API_KEY: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
});
export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid env: ${msg}`);
  }
  return result.data;
}

export const env = loadEnv();
```

- [ ] **Step 5: Run test to confirm pass**

Run: `bun test apps/api/test/env.test.ts`
Expected: PASS.

- [ ] **Step 6: Write failing health test**

Write `apps/api/test/health.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { app } from '../src/http/app';

describe('GET /healthz', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 7: Run test to confirm failure**

Run: `bun test apps/api/test/health.test.ts`
Expected: FAIL — cannot import `app`.

- [ ] **Step 8: Implement error handler + app**

Write `apps/api/src/http/error.ts`:

```ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export type ApiError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
  requestId?: string;
};

export function onError(err: unknown, c: Context): Response {
  const requestId = c.get('requestId') as string | undefined;
  if (err instanceof HTTPException) {
    return c.json<ApiError>(
      { code: err.status === 401 ? 'unauthorized' : 'http_error', message: err.message, requestId },
      err.status,
    );
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join('.')] = issue.message;
    return c.json<ApiError>({ code: 'validation_error', message: 'Validation failed', fields, requestId }, 400);
  }
  console.error('unhandled error', err);
  return c.json<ApiError>({ code: 'internal_error', message: 'Internal server error', requestId }, 500);
}
```

Write `apps/api/src/http/app.ts`:

```ts
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { cors } from 'hono/cors';
import { onError } from './error';
import { env } from '../env';

export const app = new Hono();

app.use('*', requestId());
app.use('*', cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.onError(onError);

app.get('/healthz', (c) => c.json({ status: 'ok' }));
```

Write `apps/api/src/index.ts`:

```ts
import { app } from './http/app';
import { env } from './env';

const port = env.API_PORT;
console.log(`api listening on http://localhost:${port}`);
export default { port, fetch: app.fetch };
```

- [ ] **Step 9: Install deps + run tests**

Run:

```bash
bun install
bun test apps/api
```

Expected: both tests pass.

- [ ] **Step 10: Start server manually + hit healthz**

Set env temporarily and run:

```bash
DATABASE_URL=postgres://u:p@localhost:5432/db \
  BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  BETTER_AUTH_URL=http://localhost:3000 \
  NODE_ENV=development \
  API_PORT=3000 \
  WEB_ORIGIN=http://localhost:5173 \
  bun run apps/api/src/index.ts &
curl -s http://localhost:3000/healthz
kill %1
```

Expected: `{"status":"ok"}`.

- [ ] **Step 11: Commit**

```bash
git add apps/api .env.example
git commit -m "feat(api): hono scaffold with zod env, error handler, healthz"
```

---

## Task 4: Bootstrap `web` with Vite + React + TanStack Router skeleton

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/router.tsx`
- Create: `apps/web/src/routes/__root.tsx`
- Create: `apps/web/src/routes/index.tsx`
- Create: `apps/web/src/styles/globals.css`

- [ ] **Step 1: Create web package**

Write `apps/web/package.json`:

```json
{
  "name": "@spa/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@spa/shared": "workspace:*",
    "@tanstack/react-query": "^5.59.16",
    "@tanstack/react-router": "^1.81.5",
    "@tanstack/react-table": "^8.20.5",
    "@tanstack/react-form": "^0.36.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4"
  },
  "devDependencies": {
    "@tanstack/router-plugin": "^1.81.5",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.3",
    "tailwindcss": "^3.4.14",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

Write `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src/**/*"]
}
```

Write `apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [
    TanStackRouterVite({ routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts' }),
    react(),
  ],
  server: { port: 5173 },
  build: { sourcemap: true },
});
```

Write `apps/web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1d1d1f', 2: '#6e6e73', 3: '#8e8e93' },
        hairline: '#d2d2d7',
        canvas: '#f5f5f7',
        surface: '#ffffff',
        pos: '#1f8a4c',
        neg: '#d70015',
        warn: '#b25000',
        track: '#e8e8ed',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Inter',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: { md: '10px', sm: '6px' },
    },
  },
  plugins: [],
} satisfies Config;
```

Write `apps/web/postcss.config.js`:

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

Write `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Performance Management</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Write `apps/web/src/styles/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  font-feature-settings: 'tnum' 1;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
}

body {
  background: theme('colors.canvas');
  color: theme('colors.ink.DEFAULT');
}
```

Write `apps/web/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/globals.css';
import { App } from './app';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Write `apps/web/src/router.tsx`:

```tsx
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
```

Write `apps/web/src/app.tsx`:

```tsx
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

Write `apps/web/src/routes/__root.tsx`:

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: () => <Outlet />,
});
```

Write `apps/web/src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => (
    <main className="min-h-screen grid place-items-center">
      <div className="text-ink text-sm">Performance Management — scaffolding ready.</div>
    </main>
  ),
});
```

- [ ] **Step 2: Install + build**

Run:

```bash
bun install
cd apps/web && bun run typecheck && bun run build && cd ../..
```

Expected: typecheck + build succeed. Vite emits `dist/`.

- [ ] **Step 3: Dev server smoke**

Run `cd apps/web && bun run dev` in one shell, `curl http://localhost:5173` in another. Expected: HTML returned. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): vite + react 19 + tanstack router + tailwind scaffold"
```

---

## Task 5: Test harness — test DB bootstrap + transaction rollback helper

**Files:**
- Create: `apps/api/test/setup.ts`
- Create: `apps/api/test/helpers.ts`
- Create: `apps/api/bunfig.toml`

- [ ] **Step 1: Add test tooling + pg driver**

Add to `apps/api/package.json` dependencies:

```
"drizzle-orm": "^0.36.0",
"postgres": "^3.4.5"
```

Add to devDependencies:

```
"drizzle-kit": "^0.28.0"
```

Run `bun install`.

- [ ] **Step 2: Bunfig preload for tests**

Write `apps/api/bunfig.toml`:

```toml
[test]
preload = ["./test/setup.ts"]
```

- [ ] **Step 3: Test setup that spins per-test schema**

Write `apps/api/test/setup.ts`:

```ts
import { afterAll, beforeAll } from 'bun:test';
import postgres from 'postgres';

const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const schema = `test_${crypto.randomUUID().replace(/-/g, '_').slice(0, 12)}`;

let adminSql: ReturnType<typeof postgres>;
let testSql: ReturnType<typeof postgres>;

beforeAll(async () => {
  adminSql = postgres(adminUrl, { max: 1 });
  await adminSql.unsafe(`create schema if not exists ${schema}`);
  const testUrl = `${adminUrl}?search_path=${schema}`;
  testSql = postgres(testUrl, { max: 5 });
  process.env.TEST_DATABASE_URL = testUrl;
  process.env.TEST_SCHEMA = schema;
  globalThis.__testSql = testSql;
});

afterAll(async () => {
  await testSql?.end({ timeout: 2 });
  await adminSql.unsafe(`drop schema if exists ${schema} cascade`);
  await adminSql.end({ timeout: 2 });
});

declare global {
  // eslint-disable-next-line no-var
  var __testSql: ReturnType<typeof postgres>;
}
```

- [ ] **Step 4: Rollback helper**

Write `apps/api/test/helpers.ts`:

```ts
import type { Sql } from 'postgres';

/**
 * Runs a callback inside a transaction and ALWAYS rolls back.
 * Use for tests that shouldn't persist state.
 */
export async function inRollback<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = globalThis.__testSql;
  let value!: T;
  try {
    await sql.begin(async (tx) => {
      value = await fn(tx as unknown as Sql);
      throw new Error('__rollback__');
    });
  } catch (e) {
    if (e instanceof Error && e.message === '__rollback__') return value;
    throw e;
  }
  return value;
}
```

- [ ] **Step 5: Verify setup works**

Create a throwaway `apps/api/test/setup.verify.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

describe('test setup', () => {
  it('has a test sql client', async () => {
    const result = await globalThis.__testSql`select 1 as one`;
    expect(result[0].one).toBe(1);
  });
});
```

Run: `bun test apps/api/test/setup.verify.test.ts`
Expected: PASS (requires a local Postgres on `localhost:5432` — instruct user to start one via `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`).

Delete the verify file after confirming.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "test(api): per-test schema + transaction rollback helper"
```

---

## Task 6: Drizzle config + first migration (organization, department, grade)

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/schema/org.ts`
- Create: `apps/api/src/db/schema/index.ts`
- Test: `apps/api/test/org.test.ts`

- [ ] **Step 1: Write Drizzle config**

Write `apps/api/drizzle.config.ts`:

```ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
} satisfies Config;
```

- [ ] **Step 2: Write db client**

Write `apps/api/src/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

const client = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(client, { schema });
export type DB = typeof db;
```

- [ ] **Step 3: Write org schema**

Write `apps/api/src/db/schema/org.ts`:

```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const organization = pgTable('organization', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  fiscalYearStartMonth: text('fiscal_year_start_month').notNull().default('01'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const department = pgTable('department', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organization.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const grade = pgTable('grade', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organization.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  rank: text('rank').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Schema barrel**

Write `apps/api/src/db/schema/index.ts`:

```ts
export * from './org';
```

- [ ] **Step 5: Generate + apply migration**

Run:

```bash
cd apps/api
bun run drizzle-kit generate
bun run drizzle-kit push
cd ../..
```

Expected: generates `src/db/migrations/0000_*.sql` with three tables and applies to the local dev DB.

- [ ] **Step 6: Write failing test**

Write `apps/api/test/org.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';

describe('org schema', () => {
  it('inserts + reads an organization', async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const client = postgres(url, { max: 1 });
    // Apply migration SQL manually to the test schema
    const migrations = await Bun.file('./apps/api/src/db/migrations/0000_init.sql').text().catch(() => '');
    if (migrations) await client.unsafe(migrations);

    const db = drizzle(client, { schema });
    const [inserted] = await db.insert(schema.organization).values({ name: 'Acme Sdn Bhd' }).returning();
    expect(inserted?.name).toBe('Acme Sdn Bhd');
    await client.end({ timeout: 2 });
  });
});
```

Note: the migration filename produced by drizzle-kit will be something like `0000_init.sql` after you pass `--name init` or based on the hash; update the path accordingly. A cleaner approach is a helper that reads all `.sql` files in order. Replace the `migrations` read with:

```ts
import { readdir } from 'node:fs/promises';
const dir = './apps/api/src/db/migrations';
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  const sql = await Bun.file(`${dir}/${f}`).text();
  await client.unsafe(sql);
}
```

- [ ] **Step 7: Run the test**

Run: `bun test apps/api/test/org.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): drizzle schema + migration — organization, department, grade"
```

---

## Task 7: Better Auth integration (email+password + TOTP)

**Files:**
- Modify: `apps/api/package.json` (add `better-auth`)
- Create: `apps/api/src/db/schema/auth.ts`
- Create: `apps/api/src/auth/better-auth.ts`
- Modify: `apps/api/src/http/app.ts`
- Test: `apps/api/test/auth.test.ts`

- [ ] **Step 1: Add deps**

Add to `apps/api/package.json`:

```
"better-auth": "^1.1.4"
```

Run `bun install`.

- [ ] **Step 2: Write auth schema**

Write `apps/api/src/db/schema/auth.ts`:

```ts
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  accountId: text('account_id').notNull(),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const twoFactor = pgTable('two_factor', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Add export to schema barrel**

Edit `apps/api/src/db/schema/index.ts`:

```ts
export * from './org';
export * from './auth';
```

- [ ] **Step 4: Configure Better Auth**

Write `apps/api/src/auth/better-auth.ts`:

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { env } from '../env';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    autoSignIn: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: { cookiePrefix: 'spa' },
  plugins: [twoFactor()],
});

export type Auth = typeof auth;
```

- [ ] **Step 5: Mount auth handler on Hono**

Edit `apps/api/src/http/app.ts` — add below the cors middleware:

```ts
import { auth } from '../auth/better-auth';

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
```

- [ ] **Step 6: Generate + run migration**

Run:

```bash
cd apps/api
bun run drizzle-kit generate --name auth
bun run drizzle-kit push
cd ../..
```

- [ ] **Step 7: Write failing auth test**

Write `apps/api/test/auth.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { app } from '../src/http/app';

describe('auth routes', () => {
  it('sign-up then sign-in produces a session cookie', async () => {
    const email = `u${Date.now()}@test.local`;
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple-123', name: 'Test User' }),
    });
    expect(signUp.status).toBe(200);

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple-123' }),
    });
    expect(signIn.status).toBe(200);
    const setCookie = signIn.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('spa.session_token');
  });
});
```

- [ ] **Step 8: Run + iterate**

Run: `bun test apps/api/test/auth.test.ts`
Expected: PASS (may require `DATABASE_URL` pointed at migrated dev DB).

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): integrate better-auth with drizzle adapter + totp plugin"
```

---

## Task 8: Staff table + manager hierarchy + recursive CTE helpers

**Files:**
- Create: `apps/api/src/db/schema/staff.ts`
- Create: `apps/api/src/rbac/hierarchy.ts`
- Test: `apps/api/test/hierarchy.test.ts`

- [ ] **Step 1: Staff schema**

Write `apps/api/src/db/schema/staff.ts`:

```ts
import { pgTable, pgEnum, text, timestamp, uuid, date } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { department, grade, organization } from './org';

export const roleEnum = pgEnum('role', [
  'staff',
  'appraiser',
  'next_level',
  'department_head',
  'hr_manager',
  'hra',
  'it_admin',
]);

export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'restrict' }).unique(),
  orgId: uuid('org_id').notNull().references(() => organization.id, { onDelete: 'restrict' }),
  employeeNo: text('employee_no').notNull().unique(),
  name: text('name').notNull(),
  designation: text('designation').notNull(),
  departmentId: uuid('department_id').notNull().references(() => department.id),
  gradeId: uuid('grade_id').notNull().references(() => grade.id),
  managerId: uuid('manager_id').references((): any => staff.id),
  hireDate: date('hire_date').notNull(),
  terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const staffRole = pgTable('staff_role', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Add to schema barrel.

- [ ] **Step 2: Generate + run migration**

Run:

```bash
cd apps/api
bun run drizzle-kit generate --name staff
bun run drizzle-kit push
cd ../..
```

- [ ] **Step 3: Write failing hierarchy test**

Write `apps/api/test/hierarchy.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'bun:test';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { directReports, transitiveReports } from '../src/rbac/hierarchy';

// Assumes TEST_DATABASE_URL schema has been migrated.
describe('hierarchy resolvers', () => {
  let org: string, dept: string, grd: string;
  let ceoStaff: string, vpStaff: string, mgrStaff: string, icStaff: string;

  beforeEach(async () => {
    // Seed: create org + dept + grade + 4 users + 4 staff in a chain CEO→VP→MGR→IC
    const [o] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    org = o!.id;
    const [d] = await db.insert(s.department).values({ orgId: org, name: 'IT', code: 'IT' }).returning();
    dept = d!.id;
    const [g] = await db.insert(s.grade).values({ orgId: org, code: 'E10', rank: '10' }).returning();
    grd = g!.id;

    const mkUser = async (email: string, name: string) => {
      const [u] = await db.insert(s.user).values({ email, name }).returning();
      return u!.id;
    };
    const mkStaff = async (userId: string, employeeNo: string, name: string, mgr: string | null) => {
      const [x] = await db
        .insert(s.staff)
        .values({
          userId,
          orgId: org,
          employeeNo,
          name,
          designation: 'role',
          departmentId: dept,
          gradeId: grd,
          managerId: mgr,
          hireDate: '2020-01-01',
        })
        .returning();
      return x!.id;
    };

    ceoStaff = await mkStaff(await mkUser('ceo@t', 'CEO'), 'E001', 'CEO', null);
    vpStaff = await mkStaff(await mkUser('vp@t', 'VP'), 'E002', 'VP', ceoStaff);
    mgrStaff = await mkStaff(await mkUser('mgr@t', 'MGR'), 'E003', 'MGR', vpStaff);
    icStaff = await mkStaff(await mkUser('ic@t', 'IC'), 'E004', 'IC', mgrStaff);
  });

  it('directReports returns only immediate reports', async () => {
    const reports = await directReports(db, vpStaff);
    expect(reports.map((r) => r.id)).toEqual([mgrStaff]);
  });

  it('transitiveReports with depth 2 returns 2 levels', async () => {
    const reports = await transitiveReports(db, vpStaff, 2);
    expect(reports.map((r) => r.id).sort()).toEqual([mgrStaff, icStaff].sort());
  });

  it('directReports on leaf returns empty', async () => {
    const reports = await directReports(db, icStaff);
    expect(reports).toEqual([]);
  });
});
```

- [ ] **Step 4: Run to confirm fail**

Run: `bun test apps/api/test/hierarchy.test.ts`
Expected: FAIL — cannot import `directReports`/`transitiveReports`.

- [ ] **Step 5: Implement hierarchy resolvers**

Write `apps/api/src/rbac/hierarchy.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';

export type StaffRow = { id: string; name: string; employeeNo: string; depth: number };

export async function directReports(db: DB, managerId: string): Promise<StaffRow[]> {
  const rows = await db.execute<StaffRow>(sql`
    select id, name, employee_no as "employeeNo", 1 as depth
    from staff
    where manager_id = ${managerId}
    order by name asc
  `);
  return rows.rows;
}

export async function transitiveReports(db: DB, managerId: string, maxDepth: number): Promise<StaffRow[]> {
  const rows = await db.execute<StaffRow>(sql`
    with recursive tree as (
      select id, name, employee_no, manager_id, 1 as depth
      from staff where manager_id = ${managerId}
      union all
      select s.id, s.name, s.employee_no, s.manager_id, tree.depth + 1
      from staff s join tree on s.manager_id = tree.id
      where tree.depth < ${maxDepth}
    )
    select id, name, employee_no as "employeeNo", depth from tree
    order by depth, name
  `);
  return rows.rows;
}
```

- [ ] **Step 6: Run test to confirm pass**

Run: `bun test apps/api/test/hierarchy.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): staff table + manager hierarchy + recursive CTE resolvers"
```

---

## Task 9: Audit log — schema, append-only trigger, hash chain

**Files:**
- Create: `apps/api/src/db/schema/audit.ts`
- Create: `apps/api/src/audit/hash.ts`
- Create: `apps/api/src/audit/log.ts`
- Create: `apps/api/src/audit/verifier.ts`
- Create: `apps/api/src/db/migrations/<date>_audit_trigger.sql` (raw SQL)
- Test: `apps/api/test/audit.test.ts`

- [ ] **Step 1: Audit schema**

Write `apps/api/src/db/schema/audit.ts`:

```ts
import { bigserial, customType, date, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  eventType: text('event_type').notNull(),
  actorId: uuid('actor_id'),
  actorRole: text('actor_role'),
  targetType: text('target_type'),
  targetId: text('target_id'),
  payload: jsonb('payload').notNull(),
  ip: inet('ip'),
  ua: text('ua'),
  prevHash: bytea('prev_hash').notNull(),
  hash: bytea('hash').notNull(),
  chainRoot: bytea('chain_root').notNull(),
});

export const auditAnchor = pgTable('audit_anchor', {
  date: date('date').primaryKey(),
  rootHash: bytea('root_hash').notNull(),
});
```

Add to schema barrel.

- [ ] **Step 2: Generate + run migration**

Run:

```bash
cd apps/api
bun run drizzle-kit generate --name audit
bun run drizzle-kit push
```

- [ ] **Step 3: Add append-only trigger as a raw SQL migration**

Write `apps/api/src/db/migrations/<next-number>_audit_trigger.sql` (look at the last generated number and increment):

```sql
create or replace function audit_log_reject_mut() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update on audit_log
  for each row execute function audit_log_reject_mut();

drop trigger if exists audit_log_no_delete on audit_log;
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function audit_log_reject_mut();
```

Apply:

```bash
bun run drizzle-kit push
cd ../..
```

(`drizzle-kit push` applies pending raw SQL files.)

- [ ] **Step 4: Hash helper**

Write `apps/api/src/audit/hash.ts`:

```ts
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const stringify = (v: unknown): string => {
    if (v === null) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stringify).join(',')}]`;
    if (typeof v === 'object') {
      if (seen.has(v)) throw new Error('cycle');
      seen.add(v);
      const keys = Object.keys(v as object).sort();
      const parts = keys.map((k) => `${JSON.stringify(k)}:${stringify((v as Record<string, unknown>)[k])}`);
      return `{${parts.join(',')}}`;
    }
    return 'null';
  };
  return stringify(value);
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

export function concatBytes(...parts: (Uint8Array | string)[]): Uint8Array {
  const bufs = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : p));
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) { out.set(b, o); o += b.length; }
  return out;
}
```

- [ ] **Step 5: writeAudit function**

Write `apps/api/src/audit/log.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { canonicalJson, concatBytes, sha256 } from './hash';

export type AuditInput = {
  eventType: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  ua: string | null;
};

/**
 * Must be called inside the same transaction as the domain mutation.
 * Locks the last row for SELECT to serialize chain writes.
 */
export async function writeAudit(tx: any /* drizzle tx */, input: AuditInput): Promise<Uint8Array> {
  const [last] = await tx.execute(sql`
    select hash from audit_log order by id desc limit 1 for update
  `).then((r: any) => r.rows);

  const prevHash: Uint8Array = last?.hash ?? new Uint8Array(32);
  const ts = new Date().toISOString();
  const canonical = canonicalJson({
    ts,
    eventType: input.eventType,
    actorId: input.actorId,
    payload: input.payload,
  });
  const hash = await sha256(concatBytes(prevHash, canonical));
  const chainRoot = hash; // daily anchor rewrites chainRoot to the last hash of the day

  await tx.execute(sql`
    insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
    values (${ts}, ${input.eventType}, ${input.actorId}, ${input.actorRole}, ${input.targetType}, ${input.targetId},
            ${JSON.stringify(input.payload)}::jsonb, ${input.ip}::inet, ${input.ua}, ${prevHash}, ${hash}, ${chainRoot})
  `);
  return hash;
}
```

- [ ] **Step 6: Verifier**

Write `apps/api/src/audit/verifier.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { canonicalJson, concatBytes, sha256 } from './hash';

export type VerifyResult = { ok: true } | { ok: false; failedId: bigint };

export async function verifyChain(db: DB, fromDate: string, toDate: string): Promise<VerifyResult> {
  const { rows } = await db.execute<{
    id: bigint;
    ts: string;
    event_type: string;
    actor_id: string | null;
    payload: unknown;
    prev_hash: Uint8Array;
    hash: Uint8Array;
  }>(sql`
    select id, ts, event_type, actor_id, payload, prev_hash, hash
    from audit_log
    where ts::date between ${fromDate}::date and ${toDate}::date
    order by id asc
  `);

  let prev: Uint8Array | null = null;
  for (const r of rows) {
    if (prev && !buffersEqual(prev, r.prev_hash)) return { ok: false, failedId: r.id };
    const canonical = canonicalJson({ ts: r.ts, eventType: r.event_type, actorId: r.actor_id, payload: r.payload });
    const recomputed = await sha256(concatBytes(r.prev_hash, canonical));
    if (!buffersEqual(recomputed, r.hash)) return { ok: false, failedId: r.id };
    prev = r.hash;
  }
  return { ok: true };
}

function buffersEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

- [ ] **Step 7: Failing tests**

Write `apps/api/test/audit.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { db } from '../src/db/client';
import { writeAudit } from '../src/audit/log';
import { verifyChain } from '../src/audit/verifier';

describe('audit log', () => {
  it('writes a chain and verifies OK', async () => {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'test.one',
        actorId: null, actorRole: null, targetType: null, targetId: null,
        payload: { a: 1 }, ip: null, ua: null,
      });
      await writeAudit(tx, {
        eventType: 'test.two',
        actorId: null, actorRole: null, targetType: null, targetId: null,
        payload: { b: 2 }, ip: null, ua: null,
      });
    });
    const today = new Date().toISOString().slice(0, 10);
    const result = await verifyChain(db, today, today);
    expect(result.ok).toBe(true);
  });

  it('rejects UPDATE on audit_log', async () => {
    await expect(
      db.execute(/* sql */`update audit_log set event_type = 'x' where id = 1` as any),
    ).rejects.toThrow(/append-only/);
  });
});
```

- [ ] **Step 8: Run + fix until green**

Run: `bun test apps/api/test/audit.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): append-only hash-chained audit log + verifier"
```

---

## Task 10: Hono auth middleware + actor attachment

**Files:**
- Create: `apps/api/src/auth/middleware.ts`
- Modify: `apps/api/src/http/app.ts`
- Test: `apps/api/test/middleware.test.ts`

- [ ] **Step 1: Write failing test**

Write `apps/api/test/middleware.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { app } from '../src/http/app';

describe('requireAuth middleware', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await app.request('/api/v1/me');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run fail**

Run: `bun test apps/api/test/middleware.test.ts`
Expected: FAIL — route `/api/v1/me` doesn't exist.

- [ ] **Step 3: Implement middleware**

Write `apps/api/src/auth/middleware.ts`:

```ts
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { sql } from 'drizzle-orm';
import { auth } from './better-auth';
import { db } from '../db/client';
import type { Role } from '@spa/shared';

export type Actor = {
  userId: string;
  staffId: string | null;
  roles: Role[];
  email: string;
  ip: string | null;
  ua: string | null;
};

declare module 'hono' {
  interface ContextVariableMap { actor: Actor }
}

export const requireAuth = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new HTTPException(401, { message: 'unauthenticated' });

  const { rows: staffRows } = await db.execute<{ staff_id: string }>(sql`
    select id as staff_id from staff where user_id = ${session.user.id} limit 1
  `);
  const staffId = staffRows[0]?.staff_id ?? null;

  let roles: Role[] = [];
  if (staffId) {
    const { rows } = await db.execute<{ role: Role }>(sql`select role from staff_role where staff_id = ${staffId}`);
    roles = rows.map((r) => r.role);
  }

  c.set('actor', {
    userId: session.user.id,
    staffId,
    roles,
    email: session.user.email,
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    ua: c.req.header('user-agent') ?? null,
  });
  await next();
});
```

- [ ] **Step 4: Add `/api/v1/me` route**

Edit `apps/api/src/http/app.ts`, add:

```ts
import { requireAuth } from '../auth/middleware';
// ...
app.get('/api/v1/me', requireAuth, (c) => c.json({ actor: c.get('actor') }));
```

- [ ] **Step 5: Run test to pass**

Run: `bun test apps/api/test/middleware.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): auth middleware attaches actor (user, staff, roles, ip, ua)"
```

---

## Task 11: RBAC role registry + scopedQuery wrapper

**Files:**
- Create: `apps/api/src/rbac/roles.ts`
- Create: `apps/api/src/rbac/scope.ts`
- Test: `apps/api/test/rbac-scope.test.ts`

- [ ] **Step 1: Define permissions**

Write `apps/api/src/rbac/roles.ts`:

```ts
import { Role } from '@spa/shared';

export const Permissions = {
  CycleOpen: 'cycle.open',
  KraDraft: 'kra.draft',
  KraSubmit: 'kra.submit',
  KraApprove: 'kra.approve',
  KraReject: 'kra.reject',
  StaffReadSelf: 'staff.read.self',
  StaffReadReport: 'staff.read.report',
  StaffReadDept: 'staff.read.dept',
  StaffReadOrg: 'staff.read.org',
  UserManage: 'user.manage',
  AuditRead: 'audit.read',
} as const;
export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const rolePermissions: Record<Role, Permission[]> = {
  staff: ['staff.read.self', 'kra.draft', 'kra.submit'],
  appraiser: ['staff.read.self', 'staff.read.report', 'kra.approve', 'kra.reject', 'kra.draft', 'kra.submit'],
  next_level: ['staff.read.self', 'staff.read.report'],
  department_head: ['staff.read.dept'],
  hr_manager: ['staff.read.org', 'audit.read'],
  hra: ['staff.read.org', 'cycle.open', 'audit.read'],
  it_admin: ['user.manage', 'audit.read'],
};

export function hasPermission(roles: Role[], perm: Permission): boolean {
  for (const r of roles) {
    if (rolePermissions[r]?.includes(perm)) return true;
  }
  return false;
}
```

- [ ] **Step 2: scopedQuery wrapper**

Write `apps/api/src/rbac/scope.ts`:

```ts
import { sql, type SQL } from 'drizzle-orm';
import type { Actor } from '../auth/middleware';
import { transitiveReports } from './hierarchy';
import type { DB } from '../db/client';

export type ScopePredicate = SQL;

/**
 * Returns a WHERE-clause fragment that limits `staff.id` to rows the actor may read.
 * Composed by routes: `db.select().from(staff).where(and(predicate, ...other))`.
 */
export async function staffReadScope(db: DB, actor: Actor): Promise<ScopePredicate> {
  if (actor.roles.includes('hra') || actor.roles.includes('hr_manager')) return sql`true`;

  const ids = new Set<string>();
  if (actor.staffId) ids.add(actor.staffId);

  if (actor.roles.includes('appraiser') && actor.staffId) {
    const reports = await transitiveReports(db, actor.staffId, 1);
    for (const r of reports) ids.add(r.id);
  }
  if (actor.roles.includes('next_level') && actor.staffId) {
    const reports = await transitiveReports(db, actor.staffId, 2);
    for (const r of reports) ids.add(r.id);
  }
  if (actor.roles.includes('department_head') && actor.staffId) {
    return sql`staff.department_id = (select department_id from staff where id = ${actor.staffId})`;
  }

  if (ids.size === 0) return sql`false`;
  const list = sql.join(Array.from(ids).map((id) => sql`${id}::uuid`), sql`,`);
  return sql`staff.id in (${list})`;
}
```

- [ ] **Step 3: Failing scope test**

Write `apps/api/test/rbac-scope.test.ts` — seed a 4-level chain and assert each role's visible set. (Seeding logic is similar to `hierarchy.test.ts` — copy it verbatim rather than sharing for test isolation.)

Core assertions:

```ts
it('staff role only sees self', async () => {
  const pred = await staffReadScope(db, { ...baseActor, roles: ['staff'], staffId: icStaff });
  const visible = await db.execute(sql`select id from staff where ${pred}`);
  expect(visible.rows.map((r: any) => r.id)).toEqual([icStaff]);
});

it('appraiser sees self + direct reports', async () => {
  const pred = await staffReadScope(db, { ...baseActor, roles: ['appraiser'], staffId: vpStaff });
  const visible = await db.execute(sql`select id from staff where ${pred}`);
  expect(new Set(visible.rows.map((r: any) => r.id))).toEqual(new Set([vpStaff, mgrStaff]));
});

it('hra sees everyone', async () => {
  const pred = await staffReadScope(db, { ...baseActor, roles: ['hra'], staffId: null });
  const visible = await db.execute(sql`select id from staff where ${pred}`);
  expect(visible.rows.length).toBeGreaterThanOrEqual(4);
});
```

Full file should include all three assertions with the seeding from Task 8.

- [ ] **Step 4: Run + iterate to green**

Run: `bun test apps/api/test/rbac-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): rbac permission registry + staffReadScope predicate"
```

---

## Task 12: Performance cycle table + state-machine module

**Files:**
- Create: `apps/api/src/db/schema/cycle.ts`
- Create: `apps/api/src/domain/cycle/state-machine.ts`
- Test: `apps/api/test/cycle-state-machine.test.ts`

- [ ] **Step 1: Cycle schema**

Write `apps/api/src/db/schema/cycle.ts`:

```ts
import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { staff } from './staff';

export const cycleStateEnum = pgEnum('cycle_state', [
  'kra_drafting',
  'kra_pending_approval',
  'kra_approved',
  'mid_year_open',
  'mid_year_submitted',
  'mid_year_done',
  'pms_self_review',
  'pms_awaiting_appraiser',
  'pms_awaiting_next_lvl',
  'pms_awaiting_hra',
  'pms_finalized',
]);

export const performanceCycle = pgTable('performance_cycle', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  fy: integer('fy').notNull(),
  state: cycleStateEnum('state').notNull().default('kra_drafting'),
  kraSetAt: timestamp('kra_set_at', { withTimezone: true }),
  midYearAt: timestamp('mid_year_at', { withTimezone: true }),
  pmsFinalizedAt: timestamp('pms_finalized_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalTransition = pgTable('approval_transition', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleId: uuid('cycle_id').notNull().references(() => performanceCycle.id, { onDelete: 'cascade' }),
  fromState: cycleStateEnum('from_state').notNull(),
  toState: cycleStateEnum('to_state').notNull(),
  actorId: uuid('actor_id').notNull(),
  note: text('note'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
```

Add to schema barrel. Run `drizzle-kit generate --name cycle` and `push`.

- [ ] **Step 2: State-machine module**

Write `apps/api/src/domain/cycle/state-machine.ts`:

```ts
import { CycleState } from '@spa/shared';

export type Transition = {
  from: CycleState;
  to: CycleState;
  action: string;
  roles: ReadonlyArray<'staff' | 'appraiser' | 'next_level' | 'hra'>;
};

export const transitions: Transition[] = [
  { from: CycleState.KraDrafting,         to: CycleState.KraPendingApproval, action: 'submit_kra',         roles: ['staff'] },
  { from: CycleState.KraPendingApproval,  to: CycleState.KraApproved,        action: 'approve_kra',        roles: ['appraiser'] },
  { from: CycleState.KraPendingApproval,  to: CycleState.KraDrafting,        action: 'reject_kra',         roles: ['appraiser'] },
  { from: CycleState.KraApproved,         to: CycleState.MidYearOpen,        action: 'open_mid_year',      roles: ['hra'] },
  { from: CycleState.MidYearOpen,         to: CycleState.MidYearSubmitted,   action: 'submit_mid_year',    roles: ['staff'] },
  { from: CycleState.MidYearSubmitted,    to: CycleState.MidYearDone,        action: 'ack_mid_year',       roles: ['appraiser'] },
  { from: CycleState.MidYearDone,         to: CycleState.PmsSelfReview,      action: 'open_pms',           roles: ['hra'] },
  { from: CycleState.PmsSelfReview,       to: CycleState.PmsAwaitingAppraiser, action: 'submit_self_review', roles: ['staff'] },
  { from: CycleState.PmsAwaitingAppraiser,to: CycleState.PmsSelfReview,      action: 'return_to_appraisee', roles: ['appraiser'] },
  { from: CycleState.PmsAwaitingAppraiser,to: CycleState.PmsAwaitingNextLevel, action: 'submit_appraiser_rating', roles: ['appraiser'] },
  { from: CycleState.PmsAwaitingNextLevel,to: CycleState.PmsAwaitingAppraiser, action: 'return_to_appraiser', roles: ['next_level'] },
  { from: CycleState.PmsAwaitingNextLevel,to: CycleState.PmsAwaitingHra,     action: 'submit_next_level',  roles: ['next_level'] },
  { from: CycleState.PmsAwaitingHra,      to: CycleState.PmsFinalized,       action: 'finalize',           roles: ['hra'] },
];

export type ValidateInput = { from: CycleState; action: string; actorRoles: string[] };
export type ValidateResult = { ok: true; to: CycleState } | { ok: false; reason: string };

export function validate(input: ValidateInput): ValidateResult {
  const t = transitions.find((t) => t.from === input.from && t.action === input.action);
  if (!t) return { ok: false, reason: `no transition from ${input.from} via ${input.action}` };
  const allowed = input.actorRoles.some((r) => t.roles.includes(r as any));
  if (!allowed) return { ok: false, reason: `role not authorized for ${input.action}` };
  return { ok: true, to: t.to };
}
```

- [ ] **Step 3: Failing tests**

Write `apps/api/test/cycle-state-machine.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { validate } from '../src/domain/cycle/state-machine';
import { CycleState } from '@spa/shared';

describe('cycle state machine', () => {
  it('allows staff submit_kra from kra_drafting', () => {
    const r = validate({ from: CycleState.KraDrafting, action: 'submit_kra', actorRoles: ['staff'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe(CycleState.KraPendingApproval);
  });

  it('forbids staff from approve_kra', () => {
    const r = validate({ from: CycleState.KraPendingApproval, action: 'approve_kra', actorRoles: ['staff'] });
    expect(r.ok).toBe(false);
  });

  it('allows appraiser reject_kra; returns to kra_drafting', () => {
    const r = validate({ from: CycleState.KraPendingApproval, action: 'reject_kra', actorRoles: ['appraiser'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe(CycleState.KraDrafting);
  });

  it('rejects unknown actions', () => {
    const r = validate({ from: CycleState.KraDrafting, action: 'teleport', actorRoles: ['hra'] });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run**

Run: `bun test apps/api/test/cycle-state-machine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): performance_cycle schema + state machine module"
```

---

## Task 13: KRA tables + KRA service (draft/submit/approve/reject)

**Files:**
- Create: `apps/api/src/db/schema/kra.ts`
- Create: `apps/api/src/domain/kra/service.ts`
- Test: `apps/api/test/kra-service.test.ts`

- [ ] **Step 1: KRA schema**

Write `apps/api/src/db/schema/kra.ts`:

```ts
import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { performanceCycle } from './cycle';
import { KraPerspective } from '@spa/shared';

export const perspectiveEnum = pgEnum('kra_perspective', Object.values(KraPerspective) as [string, ...string[]]);

export const kra = pgTable('kra', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleId: uuid('cycle_id').notNull().references(() => performanceCycle.id, { onDelete: 'cascade' }),
  perspective: perspectiveEnum('perspective').notNull(),
  description: text('description').notNull(),
  weightPct: integer('weight_pct').notNull(),
  measurement: text('measurement').notNull(),
  target: text('target').notNull(),
  order: integer('order').notNull(),
  rubric1to5: jsonb('rubric_1_to_5').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kraProgressUpdate = pgTable('kra_progress_update', {
  id: uuid('id').primaryKey().defaultRandom(),
  kraId: uuid('kra_id').notNull().references(() => kra.id, { onDelete: 'cascade' }),
  reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  byRole: text('by_role').notNull(),
  resultAchieved: text('result_achieved').notNull(),
  rating1to5: integer('rating_1_to_5').notNull(),
});
```

Add to schema barrel. Run `drizzle-kit generate --name kra` and `push`.

- [ ] **Step 2: KRA service**

Write `apps/api/src/domain/kra/service.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import type { KraCreateBatch } from '@spa/shared';
import { CycleState } from '@spa/shared';
import type { DB } from '../../db/client';
import type { Actor } from '../../auth/middleware';
import { kra, performanceCycle, approvalTransition } from '../../db/schema';
import { writeAudit } from '../../audit/log';
import { validate } from '../cycle/state-machine';

export async function saveKraDraft(db: DB, actor: Actor, input: KraCreateBatch): Promise<{ ok: boolean; error?: string }> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx.select().from(performanceCycle).where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (cycle.staffId !== actor.staffId) return { ok: false, error: 'not_owner' };
    if (cycle.state !== CycleState.KraDrafting) return { ok: false, error: 'wrong_state' };

    // Replace existing drafts — simple model for phase 1.
    await tx.delete(kra).where(eq(kra.cycleId, cycle.id));
    for (const k of input.kras) {
      await tx.insert(kra).values({
        cycleId: cycle.id,
        perspective: k.perspective,
        description: k.description,
        weightPct: k.weightPct,
        measurement: k.measurement,
        target: k.target,
        order: k.order,
        rubric1to5: k.rubric1to5,
      });
    }
    const total = input.kras.reduce((s, k) => s + k.weightPct, 0);
    await writeAudit(tx, {
      eventType: 'kra.drafted',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycle.id,
      payload: { count: input.kras.length, totalWeight: total },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

export async function submitKras(db: DB, actor: Actor, cycleId: string): Promise<{ ok: boolean; error?: string }> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (cycle.staffId !== actor.staffId) return { ok: false, error: 'not_owner' };

    const kras = await tx.select().from(kra).where(eq(kra.cycleId, cycleId));
    const total = kras.reduce((s, k) => s + k.weightPct, 0);
    if (kras.length < 3 || kras.length > 5 || total !== 100) return { ok: false, error: 'invalid_kra_set' };

    const v = validate({ from: cycle.state as any, action: 'submit_kra', actorRoles: actor.roles });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx.update(performanceCycle)
      .set({ state: v.to, updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycleId));
    await tx.insert(approvalTransition).values({
      cycleId, fromState: cycle.state as any, toState: v.to as any, actorId: actor.userId,
    });
    await writeAudit(tx, {
      eventType: 'kra.submitted', actorId: actor.userId, actorRole: actor.roles[0] ?? null,
      targetType: 'cycle', targetId: cycleId, payload: {}, ip: actor.ip, ua: actor.ua,
    });
    return { ok: true };
  });
}

export async function approveKras(db: DB, actor: Actor, cycleId: string): Promise<{ ok: boolean; error?: string }> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    const { rows: mgr } = await tx.execute<{ manager_id: string | null }>(sql`
      select manager_id from staff where id = ${cycle.staffId}
    `);
    if (mgr[0]?.manager_id !== actor.staffId) return { ok: false, error: 'not_manager' };

    const v = validate({ from: cycle.state as any, action: 'approve_kra', actorRoles: actor.roles });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx.update(performanceCycle)
      .set({ state: v.to, kraSetAt: new Date(), updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycleId));
    await tx.insert(approvalTransition).values({
      cycleId, fromState: cycle.state as any, toState: v.to as any, actorId: actor.userId,
    });
    await writeAudit(tx, {
      eventType: 'kra.approved', actorId: actor.userId, actorRole: actor.roles[0] ?? null,
      targetType: 'cycle', targetId: cycleId, payload: {}, ip: actor.ip, ua: actor.ua,
    });
    return { ok: true };
  });
}

export async function rejectKras(db: DB, actor: Actor, cycleId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    const { rows: mgr } = await tx.execute<{ manager_id: string | null }>(sql`
      select manager_id from staff where id = ${cycle.staffId}
    `);
    if (mgr[0]?.manager_id !== actor.staffId) return { ok: false, error: 'not_manager' };

    const v = validate({ from: cycle.state as any, action: 'reject_kra', actorRoles: actor.roles });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx.update(performanceCycle)
      .set({ state: v.to, updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycleId));
    await tx.insert(approvalTransition).values({
      cycleId, fromState: cycle.state as any, toState: v.to as any, actorId: actor.userId, note,
    });
    await writeAudit(tx, {
      eventType: 'kra.rejected', actorId: actor.userId, actorRole: actor.roles[0] ?? null,
      targetType: 'cycle', targetId: cycleId, payload: { note }, ip: actor.ip, ua: actor.ua,
    });
    return { ok: true };
  });
}
```

- [ ] **Step 3: Failing tests**

Write `apps/api/test/kra-service.test.ts` with seed-and-assert for each method: draft → submit → appraiser approves; and draft → submit → appraiser rejects → state returns to drafting. Use the seeding pattern from Task 8.

- [ ] **Step 4: Run + iterate until all pass**

Run: `bun test apps/api/test/kra-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): kra schema + service (draft, submit, approve, reject) with audit"
```

---

## Task 14: KRA routes + integration tests

**Files:**
- Create: `apps/api/src/domain/kra/routes.ts`
- Modify: `apps/api/src/http/app.ts`
- Test: `apps/api/test/kra-routes.test.ts`

- [ ] **Step 1: Routes**

Write `apps/api/src/domain/kra/routes.ts`:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { kraCreateBatch, kraApprove, kraReject } from '@spa/shared';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { saveKraDraft, submitKras, approveKras, rejectKras } from './service';

export const kraRoutes = new Hono();

kraRoutes.use('*', requireAuth);

kraRoutes.post('/draft', zValidator('json', kraCreateBatch), async (c) => {
  const actor = c.get('actor');
  const body = c.req.valid('json');
  const r = await saveKraDraft(db, actor, body);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

kraRoutes.post('/submit/:cycleId', async (c) => {
  const actor = c.get('actor');
  const r = await submitKras(db, actor, c.req.param('cycleId'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

kraRoutes.post('/approve', zValidator('json', kraApprove), async (c) => {
  const actor = c.get('actor');
  const r = await approveKras(db, actor, c.req.valid('json').cycleId);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

kraRoutes.post('/reject', zValidator('json', kraReject), async (c) => {
  const actor = c.get('actor');
  const body = c.req.valid('json');
  const r = await rejectKras(db, actor, body.cycleId, body.note);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});
```

- [ ] **Step 2: Mount**

Add to `apps/api/src/http/app.ts`:

```ts
import { kraRoutes } from '../domain/kra/routes';
app.route('/api/v1/kra', kraRoutes);
```

Add dep: `"@hono/zod-validator": "^0.4.1"` in `apps/api/package.json`.

- [ ] **Step 3: Integration test**

Write `apps/api/test/kra-routes.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { app } from '../src/http/app';

describe('POST /api/v1/kra/draft', () => {
  it('401 without cookie', async () => {
    const res = await app.request('/api/v1/kra/draft', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });
  // Full happy-path test requires seeding + a logged-in session; covered in the
  // phase-1 acceptance test (task 24) where we can drive a full flow.
});
```

- [ ] **Step 4: Run**

Run: `bun test apps/api/test/kra-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): kra routes (draft, submit, approve, reject) + auth guard"
```

---

## Task 15: Daily audit-anchor cron job

**Files:**
- Create: `apps/api/src/jobs/queue.ts`
- Create: `apps/api/src/jobs/daily-audit-anchor.ts`
- Create: `apps/api/src/worker.ts`
- Test: `apps/api/test/daily-audit-anchor.test.ts`

- [ ] **Step 1: pg-boss wiring**

Add `"pg-boss": "^10.1.5"` to `apps/api/package.json`.

Write `apps/api/src/jobs/queue.ts`:

```ts
import PgBoss from 'pg-boss';
import { env } from '../env';

export const boss = new PgBoss({ connectionString: env.DATABASE_URL });
export async function startBoss() {
  await boss.start();
}
```

- [ ] **Step 2: Anchor job**

Write `apps/api/src/jobs/daily-audit-anchor.ts`:

```ts
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export async function runDailyAuditAnchor(date: string): Promise<void> {
  await db.execute(sql`
    insert into audit_anchor (date, root_hash)
    select ${date}::date, hash
    from audit_log
    where ts::date = ${date}::date
    order by id desc
    limit 1
    on conflict (date) do update set root_hash = excluded.root_hash
  `);
}
```

- [ ] **Step 3: Worker entry + schedule**

Write `apps/api/src/worker.ts`:

```ts
import { boss, startBoss } from './jobs/queue';
import { runDailyAuditAnchor } from './jobs/daily-audit-anchor';

await startBoss();
await boss.schedule('audit.anchor.daily', '5 0 * * *', { tz: 'UTC' });
await boss.work('audit.anchor.daily', async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await runDailyAuditAnchor(yesterday);
});
console.log('worker ready');
```

- [ ] **Step 4: Test**

Write `apps/api/test/daily-audit-anchor.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client';
import { writeAudit } from '../src/audit/log';
import { runDailyAuditAnchor } from '../src/jobs/daily-audit-anchor';

describe('runDailyAuditAnchor', () => {
  it('writes an audit_anchor row matching last hash of day', async () => {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'anchor.test', actorId: null, actorRole: null, targetType: null, targetId: null,
        payload: {}, ip: null, ua: null,
      });
    });
    const today = new Date().toISOString().slice(0, 10);
    await runDailyAuditAnchor(today);
    const { rows } = await db.execute<{ date: string; root_hash: Uint8Array }>(sql`
      select date::text as date, root_hash from audit_anchor where date = ${today}::date
    `);
    expect(rows[0]?.date).toBe(today);
    expect(rows[0]?.root_hash?.length).toBe(32);
  });
});
```

- [ ] **Step 5: Run**

Run: `bun test apps/api/test/daily-audit-anchor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): pg-boss worker + daily audit-anchor cron"
```

---

## Task 16: Web — Better Auth client + login + MFA flow

**Files:**
- Create: `apps/web/src/auth/client.ts`
- Create: `apps/web/src/routes/_auth/login.tsx`
- Create: `apps/web/src/routes/_auth/mfa.tsx`

- [ ] **Step 1: Add deps**

Add to `apps/web/package.json`:

```
"better-auth": "^1.1.4"
```

Run `bun install`.

- [ ] **Step 2: Auth client**

Write `apps/web/src/auth/client.ts`:

```ts
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: '/api/auth',
  plugins: [twoFactorClient()],
});
```

- [ ] **Step 3: Login route**

Write `apps/web/src/routes/_auth/login.tsx`:

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../../auth/client';

export const Route = createFileRoute('/_auth/login')({ component: Login });

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await authClient.signIn.email({ email, password });
    if (res.error) { setError(res.error.message); return; }
    if (res.data?.twoFactorRedirect) { nav({ to: '/_auth/mfa' }); return; }
    nav({ to: '/' });
  }

  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <form onSubmit={onSubmit} className="bg-surface border border-hairline rounded-md p-8 w-96 space-y-4">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <label className="block text-xs text-ink-2">
          Email
          <input className="mt-1 block w-full border border-hairline rounded-sm px-3 py-2 text-sm"
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-xs text-ink-2">
          Password
          <input className="mt-1 block w-full border border-hairline rounded-sm px-3 py-2 text-sm"
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="text-xs text-neg">{error}</p>}
        <button className="w-full bg-ink text-white rounded-sm px-3 py-2 text-sm font-medium">Sign in</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: MFA route**

Write `apps/web/src/routes/_auth/mfa.tsx`:

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../../auth/client';

export const Route = createFileRoute('/_auth/mfa')({ component: Mfa });

function Mfa() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await authClient.twoFactor.verifyTotp({ code });
    if (res.error) { setError(res.error.message); return; }
    nav({ to: '/' });
  }

  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <form onSubmit={onSubmit} className="bg-surface border border-hairline rounded-md p-8 w-96 space-y-4">
        <h1 className="text-lg font-semibold">Two-factor authentication</h1>
        <p className="text-xs text-ink-2">Enter the 6-digit code from your authenticator app.</p>
        <input className="w-full tracking-widest text-center border border-hairline rounded-sm px-3 py-3 text-lg font-mono"
          inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        {error && <p className="text-xs text-neg">{error}</p>}
        <button className="w-full bg-ink text-white rounded-sm px-3 py-2 text-sm font-medium">Verify</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): better-auth client + login + mfa routes"
```

---

## Task 17: Web — app shell (sidebar, topbar, role-based redirect)

**Files:**
- Create: `apps/web/src/components/AppShell.tsx`
- Create: `apps/web/src/routes/_app.tsx` (layout route)
- Replace: `apps/web/src/routes/index.tsx` (redirect logic)

- [ ] **Step 1: AppShell**

Write `apps/web/src/components/AppShell.tsx`:

```tsx
import { Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';

type Section = { to: string; label: string };
const sections: Section[] = [
  { to: '/me', label: 'Me' },
  { to: '/team', label: 'Team' },
  { to: '/department', label: 'Department' },
  { to: '/hr', label: 'HR' },
  { to: '/admin', label: 'Admin' },
];

export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-screen grid grid-cols-[220px_1fr]">
      <aside className="border-r border-hairline bg-surface p-4 space-y-2">
        <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase mb-4">Performance</div>
        {sections.map((s) => (
          <Link key={s.to} to={s.to}
            className="block text-sm text-ink hover:bg-canvas rounded-sm px-2 py-1.5"
            activeProps={{ className: 'bg-canvas' }}>
            {s.label}
          </Link>
        ))}
      </aside>
      <section>
        <header className="h-14 border-b border-hairline bg-surface flex items-center px-6 text-xs text-ink-2">
          FY 2026 · KRA drafting
        </header>
        <main className="p-8">{children ?? <Outlet />}</main>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Layout route**

Write `apps/web/src/routes/_app.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';
import { authClient } from '../auth/client';

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) throw redirect({ to: '/_auth/login' });
  },
  component: AppShell,
});
```

- [ ] **Step 3: Root index — redirect by role**

Replace `apps/web/src/routes/index.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => { throw redirect({ to: '/me' }); },
});
```

- [ ] **Step 4: Build + smoke**

Run:

```bash
cd apps/web && bun run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): app shell with sidebar, topbar, auth-gated layout route"
```

---

## Task 18: Web — staff dashboard index + cycle-status widget (empty state)

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/routes/_app/me/index.tsx`

- [ ] **Step 1: API client**

Write `apps/web/src/api/client.ts`:

```ts
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.code ?? 'error', body.message ?? 'Request failed', body.fields);
  return body as T;
}
```

- [ ] **Step 2: Staff dashboard**

Write `apps/web/src/routes/_app/me/index.tsx`:

```tsx
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';

type MeResponse = { actor: { userId: string; staffId: string | null; roles: string[]; email: string } };
type MyCycle = { id: string; fy: number; state: string };

export const Route = createFileRoute('/_app/me/')({
  component: Me,
});

function Me() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/api/v1/me') });
  const cycle = useQuery({
    queryKey: ['cycle', 'current'],
    queryFn: () => api<{ cycle: MyCycle | null }>('/api/v1/cycle/current'),
    enabled: !!me.data?.actor.staffId,
  });

  if (me.isLoading) return <div className="text-xs text-ink-2">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-2">Signed in</div>
        <div className="text-sm">{me.data?.actor.email}</div>
      </div>
      <div className="bg-surface border border-hairline rounded-md p-6">
        <div className="text-xs uppercase tracking-wider text-ink-2 mb-3">Current cycle</div>
        {!cycle.data?.cycle ? (
          <div className="text-sm text-ink-2">No active cycle. Wait for HR to open the KRA window.</div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">FY {cycle.data.cycle.fy}</div>
            <div className="text-xs text-ink-2">State: {cycle.data.cycle.state}</div>
            {cycle.data.cycle.state === 'kra_drafting' || cycle.data.cycle.state === 'kra_pending_approval' ? (
              <Link to="/me/kra" className="inline-block bg-ink text-white rounded-sm px-3 py-1.5 text-sm">Edit KRAs</Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `/api/v1/cycle/current` endpoint (api side)**

Add to `apps/api/src/domain/cycle/routes.ts` (create the file):

```ts
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { performanceCycle } from '../../db/schema';

export const cycleRoutes = new Hono();
cycleRoutes.use('*', requireAuth);

cycleRoutes.get('/current', async (c) => {
  const actor = c.get('actor');
  if (!actor.staffId) return c.json({ cycle: null });
  const [row] = await db
    .select()
    .from(performanceCycle)
    .where(eq(performanceCycle.staffId, actor.staffId))
    .orderBy(desc(performanceCycle.fy))
    .limit(1);
  return c.json({ cycle: row ?? null });
});
```

Mount in `apps/api/src/http/app.ts`:

```ts
import { cycleRoutes } from '../domain/cycle/routes';
app.route('/api/v1/cycle', cycleRoutes);
```

- [ ] **Step 4: Build + smoke**

Run the dev servers and verify `/me` shows empty state when no cycle exists.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web
git commit -m "feat(web,api): staff dashboard + /api/v1/cycle/current"
```

---

## Task 19: Web — KRA form (TanStack Form + Zod)

**Files:**
- Create: `apps/web/src/routes/_app/me/kra.tsx`

- [ ] **Step 1: KRA form**

Write `apps/web/src/routes/_app/me/kra.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kraCreateBatch, KraPerspective, type KraDraft } from '@spa/shared';
import { api } from '../../../api/client';

export const Route = createFileRoute('/_app/me/kra')({ component: KraForm });

const emptyKra = (order: number): KraDraft => ({
  perspective: KraPerspective.Financial,
  description: '',
  weightPct: 25,
  measurement: '',
  target: '',
  order,
  rubric1to5: ['', '', '', '', ''],
});

function KraForm() {
  const qc = useQueryClient();
  const cycle = useQuery({
    queryKey: ['cycle', 'current'],
    queryFn: () => api<{ cycle: { id: string; fy: number; state: string } | null }>('/api/v1/cycle/current'),
  });

  const save = useMutation({
    mutationFn: (body: unknown) => api('/api/v1/kra/draft', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycle'] }),
  });

  const submit = useMutation({
    mutationFn: (cycleId: string) => api(`/api/v1/kra/submit/${cycleId}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycle'] }),
  });

  const form = useForm({
    defaultValues: { kras: [emptyKra(0), emptyKra(1), emptyKra(2), emptyKra(3)] as KraDraft[] },
    onSubmit: async ({ value }) => {
      if (!cycle.data?.cycle) return;
      await save.mutateAsync(
        kraCreateBatch.parse({ cycleId: cycle.data.cycle.id, kras: value.kras }),
      );
    },
  });

  if (!cycle.data?.cycle) return <div className="text-xs text-ink-2">No active cycle.</div>;

  const totalWeight = form.getFieldValue('kras').reduce((s: number, k: KraDraft) => s + (k.weightPct ?? 0), 0);
  const valid = totalWeight === 100;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-lg font-semibold">Key Result Areas — FY {cycle.data.cycle.fy}</h1>

      <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
        <form.Field name="kras" mode="array">
          {(field) => (
            <div className="space-y-4">
              {field.state.value.map((_k: KraDraft, i: number) => (
                <div key={i} className="bg-surface border border-hairline rounded-md p-5 space-y-3">
                  <div className="flex items-center gap-4">
                    <span className="text-xs uppercase tracking-wider text-ink-2">KRA {i + 1}</span>
                    <form.Field name={`kras[${i}].perspective`}>
                      {(f) => (
                        <select value={f.state.value} onChange={(e) => f.handleChange(e.target.value as any)}
                          className="text-sm border border-hairline rounded-sm px-2 py-1">
                          {Object.values(KraPerspective).map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      )}
                    </form.Field>
                  </div>
                  <form.Field name={`kras[${i}].description`}>
                    {(f) => (
                      <textarea value={f.state.value} onChange={(e) => f.handleChange(e.target.value)}
                        rows={2} className="block w-full text-sm border border-hairline rounded-sm p-2"
                        placeholder="Description" />
                    )}
                  </form.Field>
                  <div className="grid grid-cols-2 gap-3">
                    <form.Field name={`kras[${i}].measurement`}>
                      {(f) => (
                        <input value={f.state.value} onChange={(e) => f.handleChange(e.target.value)}
                          className="text-sm border border-hairline rounded-sm p-2" placeholder="Measurement" />
                      )}
                    </form.Field>
                    <form.Field name={`kras[${i}].target`}>
                      {(f) => (
                        <input value={f.state.value} onChange={(e) => f.handleChange(e.target.value)}
                          className="text-sm border border-hairline rounded-sm p-2" placeholder="Target" />
                      )}
                    </form.Field>
                  </div>
                  <form.Field name={`kras[${i}].weightPct`}>
                    {(f) => (
                      <label className="text-xs text-ink-2">Weight %
                        <input type="number" min={1} max={100}
                          value={f.state.value}
                          onChange={(e) => f.handleChange(Number(e.target.value))}
                          className="ml-2 w-20 text-sm border border-hairline rounded-sm p-1" />
                      </label>
                    )}
                  </form.Field>
                  <div className="grid grid-cols-5 gap-2">
                    {[0,1,2,3,4].map((idx) => (
                      <form.Field key={idx} name={`kras[${i}].rubric1to5[${idx}]`}>
                        {(f) => (
                          <input value={f.state.value} onChange={(e) => f.handleChange(e.target.value)}
                            className="text-xs border border-hairline rounded-sm p-2"
                            placeholder={`Anchor ${idx + 1}`} />
                        )}
                      </form.Field>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </form.Field>

        <div className="flex items-center justify-between bg-surface border border-hairline rounded-md p-4">
          <div className="text-sm">
            Total weight: <span className={valid ? 'text-pos' : 'text-neg'}>{totalWeight}%</span>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm">Save draft</button>
            <button type="button" disabled={!valid}
              onClick={() => cycle.data?.cycle && submit.mutate(cycle.data.cycle.id)}
              className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm disabled:opacity-50">
              Submit for approval
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke**

Launch both dev servers. Sign up, sign in, navigate to `/me/kra`. Verify form renders, weight sum updates, save/submit calls the api and errors surface on failure.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): kra form with tanstack form + weight-total validator"
```

---

## Task 20: Web — appraiser KRA approval page

**Files:**
- Create: `apps/web/src/routes/_app/team/kra-approve.$staffId.tsx`
- Modify: `apps/api/src/domain/kra/routes.ts` (add `GET /kra/:cycleId`)

- [ ] **Step 1: Add GET route on api**

In `apps/api/src/domain/kra/routes.ts` add:

```ts
kraRoutes.get('/:cycleId', async (c) => {
  const cycleId = c.req.param('cycleId');
  const rows = await db.select().from(kra).where(eq(kra.cycleId, cycleId)).orderBy(kra.order);
  return c.json({ kras: rows });
});
```

Add imports for `eq` and `kra`.

- [ ] **Step 2: Web page**

Write `apps/web/src/routes/_app/team/kra-approve.$staffId.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../api/client';

export const Route = createFileRoute('/_app/team/kra-approve/$staffId')({
  component: KraApprove,
});

type KraRow = { id: string; description: string; weightPct: number; perspective: string; measurement: string; target: string };

function KraApprove() {
  const { staffId } = Route.useParams();
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const cycle = useQuery({
    queryKey: ['cycle', 'for-staff', staffId],
    queryFn: () => api<{ cycle: { id: string; state: string } }>(`/api/v1/cycle/for-staff/${staffId}`),
  });

  const kras = useQuery({
    queryKey: ['kras', cycle.data?.cycle.id],
    queryFn: () => api<{ kras: KraRow[] }>(`/api/v1/kra/${cycle.data!.cycle.id}`),
    enabled: !!cycle.data?.cycle.id,
  });

  const approve = useMutation({
    mutationFn: () => api('/api/v1/kra/approve', {
      method: 'POST',
      body: JSON.stringify({ cycleId: cycle.data!.cycle.id }),
    }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const reject = useMutation({
    mutationFn: () => api('/api/v1/kra/reject', {
      method: 'POST',
      body: JSON.stringify({ cycleId: cycle.data!.cycle.id, note }),
    }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (cycle.isLoading) return <div className="text-xs text-ink-2">Loading…</div>;
  if (!cycle.data?.cycle) return <div className="text-xs text-ink-2">No cycle found.</div>;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-lg font-semibold">Review KRAs</h1>
      <div className="text-xs text-ink-2">State: {cycle.data.cycle.state}</div>

      <div className="space-y-3">
        {kras.data?.kras.map((k) => (
          <div key={k.id} className="bg-surface border border-hairline rounded-md p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-xs uppercase tracking-wider text-ink-2">{k.perspective}</div>
              <div className="text-xs text-ink-2">{k.weightPct}%</div>
            </div>
            <div className="text-sm mt-2">{k.description}</div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-ink-2">
              <div><strong className="text-ink">Measurement:</strong> {k.measurement}</div>
              <div><strong className="text-ink">Target:</strong> {k.target}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-hairline rounded-md p-4 space-y-3">
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full border border-hairline rounded-sm p-2 text-sm" rows={2}
          placeholder="Rejection note (required if rejecting)" />
        <div className="flex gap-3">
          <button onClick={() => approve.mutate()}
            className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm">Approve</button>
          <button onClick={() => reject.mutate()} disabled={note.length < 3}
            className="bg-neg text-white rounded-sm px-3 py-1.5 text-sm disabled:opacity-50">Reject</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `/api/v1/cycle/for-staff/:staffId` endpoint**

In `apps/api/src/domain/cycle/routes.ts`:

```ts
cycleRoutes.get('/for-staff/:staffId', async (c) => {
  const staffId = c.req.param('staffId');
  const [row] = await db
    .select()
    .from(performanceCycle)
    .where(eq(performanceCycle.staffId, staffId))
    .orderBy(desc(performanceCycle.fy))
    .limit(1);
  if (!row) return c.json({ cycle: null }, 404);
  return c.json({ cycle: row });
});
```

(Scope-gate via RBAC in Task 11 once you wire it into routes — for phase-1 trust the authed middleware + service-level ownership check.)

- [ ] **Step 4: Commit**

```bash
git add apps/api apps/web
git commit -m "feat(web,api): appraiser kra approval page with approve/reject"
```

---

## Task 21: Bulk staff + hierarchy CSV import (HRA-only)

**Files:**
- Create: `apps/api/src/domain/staff/import.ts`
- Create: `apps/api/src/domain/staff/routes.ts`
- Test: `apps/api/test/staff-import.test.ts`
- Create: `infra/seeds/sample-staff.csv`

- [ ] **Step 1: Sample CSV**

Write `infra/seeds/sample-staff.csv`:

```csv
employee_no,email,name,designation,department_code,grade_code,manager_employee_no,hire_date,roles
E001,ceo@acme.com,Alya CEO,Chief Exec,EXEC,E12,,2015-01-01,hra
E002,vp@acme.com,Bakar VP,VP Operations,OPS,E11,E001,2017-03-15,appraiser;next_level
E003,mgr@acme.com,Chong Manager,Manager,IT,E09,E002,2020-06-01,appraiser
E004,ic@acme.com,Dewi Engineer,Engineer,IT,E07,E003,2022-01-10,staff
```

- [ ] **Step 2: Import service**

Write `apps/api/src/domain/staff/import.ts`:

```ts
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import * as s from '../../db/schema';

const row = z.object({
  employee_no: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  designation: z.string().min(1),
  department_code: z.string().min(1),
  grade_code: z.string().min(1),
  manager_employee_no: z.string().optional().default(''),
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roles: z.string().optional().default(''),
});

export type ImportReport = { created: number; updated: number; errors: string[] };

export async function importStaffCsv(orgId: string, csv: string): Promise<ImportReport> {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.split(',').map((h) => h.trim());
  const data = lines.slice(1).map((l) => {
    const vals = l.split(',');
    const obj: Record<string, string> = {};
    header.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim(); });
    return obj;
  });

  const report: ImportReport = { created: 0, updated: 0, errors: [] };
  const empToStaffId = new Map<string, string>();

  // Pass 1: upsert staff without manager linkage
  for (const raw of data) {
    const parsed = row.safeParse(raw);
    if (!parsed.success) {
      report.errors.push(`row ${raw.employee_no ?? '?'}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      continue;
    }
    const r = parsed.data;

    await db.transaction(async (tx) => {
      // department + grade resolve (by code)
      const [dept] = await tx.select().from(s.department).where(sql`code = ${r.department_code} and org_id = ${orgId}`);
      const [grade] = await tx.select().from(s.grade).where(sql`code = ${r.grade_code} and org_id = ${orgId}`);
      if (!dept || !grade) {
        report.errors.push(`row ${r.employee_no}: missing dept or grade`);
        return;
      }

      // user upsert
      const { rows: existingUser } = await tx.execute<{ id: string }>(sql`
        select id from "user" where email = ${r.email}
      `);
      let userId = existingUser[0]?.id;
      if (!userId) {
        const [u] = await tx.insert(s.user).values({ email: r.email, name: r.name }).returning();
        userId = u!.id;
      }

      // staff upsert
      const { rows: existingStaff } = await tx.execute<{ id: string }>(sql`
        select id from staff where employee_no = ${r.employee_no}
      `);
      let staffId: string;
      if (existingStaff[0]) {
        await tx.update(s.staff).set({
          name: r.name, designation: r.designation, departmentId: dept.id, gradeId: grade.id, updatedAt: new Date(),
        }).where(sql`id = ${existingStaff[0].id}`);
        staffId = existingStaff[0].id;
        report.updated++;
      } else {
        const [st] = await tx.insert(s.staff).values({
          orgId,
          userId: userId!,
          employeeNo: r.employee_no,
          name: r.name,
          designation: r.designation,
          departmentId: dept.id,
          gradeId: grade.id,
          managerId: null,
          hireDate: r.hire_date,
        }).returning();
        staffId = st!.id;
        report.created++;
      }
      empToStaffId.set(r.employee_no, staffId);

      // roles
      if (r.roles) {
        await tx.delete(s.staffRole).where(sql`staff_id = ${staffId}`);
        for (const role of r.roles.split(';').map((x) => x.trim()).filter(Boolean)) {
          await tx.insert(s.staffRole).values({ staffId, role: role as any });
        }
      }
    });
  }

  // Pass 2: link managers
  for (const raw of data) {
    if (!raw.manager_employee_no) continue;
    const childId = empToStaffId.get(raw.employee_no);
    const mgrId = empToStaffId.get(raw.manager_employee_no);
    if (!childId || !mgrId) {
      report.errors.push(`row ${raw.employee_no}: manager ${raw.manager_employee_no} not found`);
      continue;
    }
    await db.execute(sql`update staff set manager_id = ${mgrId} where id = ${childId}`);
  }

  return report;
}
```

- [ ] **Step 3: HRA-only route**

Write `apps/api/src/domain/staff/routes.ts`:

```ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../../auth/middleware';
import { hasPermission, Permissions } from '../../rbac/roles';
import { importStaffCsv } from './import';

export const staffRoutes = new Hono();
staffRoutes.use('*', requireAuth);

staffRoutes.post('/import', async (c) => {
  const actor = c.get('actor');
  if (!hasPermission(actor.roles, Permissions.UserManage) && !actor.roles.includes('hra')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const csv = await c.req.text();
  const orgId = c.req.query('orgId');
  if (!orgId) throw new HTTPException(400, { message: 'orgId required' });
  const report = await importStaffCsv(orgId, csv);
  return c.json(report);
});
```

Mount in `app.ts`:

```ts
import { staffRoutes } from '../domain/staff/routes';
app.route('/api/v1/staff', staffRoutes);
```

- [ ] **Step 4: Tests**

Write `apps/api/test/staff-import.test.ts` — seed an org, dept, grade; pass the sample CSV; assert report counts and that the chain CEO→VP→MGR→IC resolves correctly.

- [ ] **Step 5: Commit**

```bash
git add apps/api infra/seeds
git commit -m "feat(api): bulk staff + hierarchy csv import with 2-pass linking"
```

---

## Task 22: Railway deployment config + smoke deploy

**Files:**
- Create: `infra/railway.json`
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile` (or use Railway static plugin)

- [ ] **Step 1: Dockerfile for api**

Write `apps/api/Dockerfile`:

```Dockerfile
FROM oven/bun:1.1.34-alpine AS base
WORKDIR /app
COPY package.json bun.lockb tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN bun install --frozen-lockfile --production
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["bun", "src/index.ts"]
```

And `apps/api/Dockerfile.worker`:

```Dockerfile
FROM oven/bun:1.1.34-alpine
WORKDIR /app
COPY package.json bun.lockb tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN bun install --frozen-lockfile --production
ENV NODE_ENV=production
WORKDIR /app/apps/api
CMD ["bun", "src/worker.ts"]
```

- [ ] **Step 2: Web builds to static**

Web is built via `bun run build` and served by Railway's static serving. No Dockerfile needed.

- [ ] **Step 3: railway.json**

Write `infra/railway.json`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "DOCKERFILE" },
  "deploy": {
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

Railway project structure (set up via UI or CLI):
- Service `db`: Postgres plugin.
- Service `api`: Dockerfile `apps/api/Dockerfile`, healthcheck `/healthz`.
- Service `worker`: Dockerfile `apps/api/Dockerfile.worker`.
- Service `web`: static from `apps/web/dist` after build.

- [ ] **Step 4: Deploy smoke**

Using Railway CLI:

```bash
railway login
railway link
railway up
```

Expected: services deploy. `curl $API_URL/healthz` returns `{"status":"ok"}`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/Dockerfile apps/api/Dockerfile.worker infra/railway.json
git commit -m "chore: railway deploy config + dockerfiles"
```

---

## Task 23: CI pipeline (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: CI workflow**

Write `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.1.34
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - name: migrate
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
        run: |
          cd apps/api
          bun run drizzle-kit push
      - name: test
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
          BETTER_AUTH_SECRET: "testing-secret-must-be-at-least-32-chars"
          BETTER_AUTH_URL: http://localhost:3000
          NODE_ENV: test
          API_PORT: 3000
          WEB_ORIGIN: http://localhost:5173
        run: bun test
      - run: cd apps/web && bun run build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: bun install + lint + typecheck + migrate + test + web build"
```

---

## Task 24: Phase-1 acceptance test (end-to-end)

**Files:**
- Create: `apps/api/test/acceptance-phase-1.test.ts`

- [ ] **Step 1: Write acceptance test**

Write `apps/api/test/acceptance-phase-1.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { app } from '../src/http/app';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { verifyChain } from '../src/audit/verifier';
import { KraPerspective } from '@spa/shared';

async function signUp(email: string, name: string, password: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${await res.text()}`);
  return res.headers.get('set-cookie') ?? '';
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed: ${await res.text()}`);
  return res.headers.get('set-cookie') ?? '';
}

async function postAs(cookie: string, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

describe('phase 1 acceptance', () => {
  it('completes the full KRA happy path end-to-end', async () => {
    // 1. seed org, department, grade
    const [org] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, name: 'IT', code: 'IT' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'E10', rank: '10' })
      .returning();

    // 2. sign up 2 users (staff + manager) via Better Auth
    const mgrEmail = `mgr-${Date.now()}@t.local`;
    const staffEmail = `staff-${Date.now()}@t.local`;
    const pw = 'correct-horse-battery-staple-123';

    await signUp(mgrEmail, 'Manager Person', pw);
    await signUp(staffEmail, 'Staff Person', pw);

    const { rows: mgrUser } = await db.execute<{ id: string }>(sql`
      select id from "user" where email = ${mgrEmail}
    `);
    const { rows: staffUser } = await db.execute<{ id: string }>(sql`
      select id from "user" where email = ${staffEmail}
    `);

    // 3. seed staff rows with manager relationship
    const [mgrStaff] = await db
      .insert(s.staff)
      .values({
        userId: mgrUser[0]!.id,
        orgId: org!.id,
        employeeNo: 'E100',
        name: 'Manager Person',
        designation: 'Manager',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    const [staffRec] = await db
      .insert(s.staff)
      .values({
        userId: staffUser[0]!.id,
        orgId: org!.id,
        employeeNo: 'E101',
        name: 'Staff Person',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: mgrStaff!.id,
        hireDate: '2022-01-01',
      })
      .returning();

    // 4. assign roles
    await db.insert(s.staffRole).values([
      { staffId: mgrStaff!.id, role: 'appraiser' },
      { staffId: staffRec!.id, role: 'staff' },
    ]);

    // 5. HRA opens a cycle for the staff member (direct DB insert — HRA UI is Phase 2)
    const [cycle] = await db
      .insert(s.performanceCycle)
      .values({ staffId: staffRec!.id, fy: 2026, state: 'kra_drafting' })
      .returning();

    // 6. staff signs in and drafts 4 KRAs totalling 100%
    const staffCookie = await signIn(staffEmail, pw);
    const kras = [0, 1, 2, 3].map((i) => ({
      perspective: KraPerspective.Financial,
      description: `Deliver meaningful outcome #${i + 1} for the year.`,
      weightPct: 25,
      measurement: 'Milestone tracking',
      target: 'All milestones met',
      order: i,
      rubric1to5: ['r1', 'r2', 'r3', 'r4', 'r5'],
    }));

    const draftRes = await postAs(staffCookie, '/api/v1/kra/draft', {
      cycleId: cycle!.id,
      kras,
    });
    expect(draftRes.status).toBe(200);

    // 7. staff submits for approval
    const submitRes = await app.request(`/api/v1/kra/submit/${cycle!.id}`, {
      method: 'POST',
      headers: { cookie: staffCookie },
    });
    expect(submitRes.status).toBe(200);

    const [afterSubmit] = await db
      .select()
      .from(s.performanceCycle)
      .where(sql`id = ${cycle!.id}`);
    expect(afterSubmit?.state).toBe('kra_pending_approval');

    // 8. manager signs in and approves
    const mgrCookie = await signIn(mgrEmail, pw);
    const approveRes = await postAs(mgrCookie, '/api/v1/kra/approve', {
      cycleId: cycle!.id,
    });
    expect(approveRes.status).toBe(200);

    const [afterApprove] = await db
      .select()
      .from(s.performanceCycle)
      .where(sql`id = ${cycle!.id}`);
    expect(afterApprove?.state).toBe('kra_approved');
    expect(afterApprove?.kraSetAt).not.toBeNull();

    // 9. audit_log contains the four expected events
    const { rows: audit } = await db.execute<{ event_type: string }>(sql`
      select event_type from audit_log
      where target_id = ${cycle!.id}
      order by id asc
    `);
    const events = audit.map((r) => r.event_type);
    expect(events).toEqual(['kra.drafted', 'kra.submitted', 'kra.approved']);

    // 10. chain verification passes for today's range
    const today = new Date().toISOString().slice(0, 10);
    const verifyResult = await verifyChain(db, today, today);
    expect(verifyResult.ok).toBe(true);
  });

  it('return-to-appraisee path: reject sends cycle back to kra_drafting with note', async () => {
    const [org] = await db.insert(s.organization).values({ name: 'Acme2' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, name: 'Ops', code: 'OPS' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'E08', rank: '8' })
      .returning();

    const pw = 'correct-horse-battery-staple-123';
    const mgrEmail = `mgr2-${Date.now()}@t.local`;
    const staffEmail = `staff2-${Date.now()}@t.local`;
    await signUp(mgrEmail, 'Mgr Two', pw);
    await signUp(staffEmail, 'Staff Two', pw);

    const { rows: mgrUser } = await db.execute<{ id: string }>(sql`
      select id from "user" where email = ${mgrEmail}
    `);
    const { rows: staffUser } = await db.execute<{ id: string }>(sql`
      select id from "user" where email = ${staffEmail}
    `);

    const [mgrStaff] = await db.insert(s.staff).values({
      userId: mgrUser[0]!.id,
      orgId: org!.id,
      employeeNo: 'E200',
      name: 'Mgr Two',
      designation: 'Manager',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2020-01-01',
    }).returning();
    const [staffRec] = await db.insert(s.staff).values({
      userId: staffUser[0]!.id,
      orgId: org!.id,
      employeeNo: 'E201',
      name: 'Staff Two',
      designation: 'Analyst',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: mgrStaff!.id,
      hireDate: '2022-01-01',
    }).returning();
    await db.insert(s.staffRole).values([
      { staffId: mgrStaff!.id, role: 'appraiser' },
      { staffId: staffRec!.id, role: 'staff' },
    ]);

    const [cycle] = await db.insert(s.performanceCycle).values({
      staffId: staffRec!.id,
      fy: 2026,
      state: 'kra_drafting',
    }).returning();

    const staffCookie = await signIn(staffEmail, pw);
    await postAs(staffCookie, '/api/v1/kra/draft', {
      cycleId: cycle!.id,
      kras: [0, 1, 2].map((i) => ({
        perspective: KraPerspective.Financial,
        description: `KRA ${i}`,
        weightPct: i === 0 ? 40 : 30,
        measurement: 'm',
        target: 't',
        order: i,
        rubric1to5: ['a', 'b', 'c', 'd', 'e'],
      })),
    });
    await app.request(`/api/v1/kra/submit/${cycle!.id}`, {
      method: 'POST',
      headers: { cookie: staffCookie },
    });

    const mgrCookie = await signIn(mgrEmail, pw);
    const rejectRes = await postAs(mgrCookie, '/api/v1/kra/reject', {
      cycleId: cycle!.id,
      note: 'KRA 1 needs a measurable target',
    });
    expect(rejectRes.status).toBe(200);

    const [afterReject] = await db
      .select()
      .from(s.performanceCycle)
      .where(sql`id = ${cycle!.id}`);
    expect(afterReject?.state).toBe('kra_drafting');

    const { rows: transitions } = await db.execute<{
      from_state: string;
      to_state: string;
      note: string | null;
    }>(sql`
      select from_state, to_state, note from approval_transition
      where cycle_id = ${cycle!.id}
      order by at asc
    `);
    expect(transitions).toHaveLength(2);
    expect(transitions[1]?.from_state).toBe('kra_pending_approval');
    expect(transitions[1]?.to_state).toBe('kra_drafting');
    expect(transitions[1]?.note).toBe('KRA 1 needs a measurable target');
  });
});
```

This test is long because it drives the entire Phase-1 surface. Keep it in one file.

- [ ] **Step 2: Run until green**

Run: `bun test apps/api/test/acceptance-phase-1.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api
git commit -m "test(api): phase-1 acceptance — kra happy path + audit chain verify"
```

---

## Phase-1 exit verification

- [ ] All tests pass locally: `bun test`
- [ ] `bun run lint` clean
- [ ] `bun run typecheck` clean (all workspaces)
- [ ] `cd apps/web && bun run build` clean
- [ ] CI green on a PR
- [ ] Railway deploy responds on `/healthz`
- [ ] Manual end-to-end in browser: sign up → sign in → MFA enroll → staff sees empty state → HRA (you, via DB direct) opens a cycle → staff draft KRAs → submit → appraiser approves → audit log shows chain
- [ ] `verifyChain` returns ok for today's range
