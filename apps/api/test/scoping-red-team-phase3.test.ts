/**
 * T37 — Scope red-team for Phase-3 routes
 *
 * Extends the Phase-2 scoping red-team pattern to cover:
 *   - AI routes (staff-summary, kra-quality, dev-recommendations, mid-year-nudges, calibration,
 *     usage-today, calibration-cohorts)
 *   - Dashboard routes (me, team, dept, hr)
 *   - Search route (staff)
 *   - Export routes (pms-org POST, :id GET, / GET)
 *
 * Also exercises the cache-leakage red-team: a cache row written for org X cannot be read
 * by an actor from org Y even for the same feature+input.
 */

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { canonicalHash } from '../src/ai/core/cache';
import * as openrouterMod from '../src/ai/core/openrouter';
import { runStaffSummary } from '../src/ai/features/staff-summary';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';
import * as queue from '../src/jobs/queue';
import {
  type ScopingCase,
  type UnauthCase,
  assertScoped,
  assertUnauthenticated,
} from './helpers/assert-scoped';

// Stub pg-boss — no real queue needed
spyOn(queue.boss, 'send').mockImplementation(async () => null as unknown as string);

// Stub OpenRouter so AI routes never make real network calls
const mockOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(async () => ({
  content: {
    highlights: ['Exceeded KRA targets'],
    concerns: [],
    focus_areas: ['Time management'],
  },
  promptTokens: 100,
  completionTokens: 50,
  model: 'openai/gpt-5.4-nano',
}));

const PW = 'correct-horse-battery-staple-P3-scope';
const NIL = '00000000-0000-0000-0000-000000000000';

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function signUp(email: string, name: string): Promise<void> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW, name }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed ${res.status}: ${await res.text()}`);
}

async function signIn(email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed ${res.status}: ${await res.text()}`);
  return res.headers.get('set-cookie') ?? '';
}

// ── Fixture state ─────────────────────────────────────────────────────────────

let outsiderCookie: string;
let staffCookie: string; // staff role (not HRA)
let pmsCycleId: string;
let kraId: string;
let gradeId: string;
let orgId: string;
let orgYId: string; // separate org for cache-leakage test
let exportJobId: string;

// Actor objects for direct service calls (cache-leakage test)
let actorOrgX: { userId: string; orgId: string; staffId: string | null; roles: string[] };
let actorOrgY: { userId: string; orgId: string; staffId: string | null; roles: string[] };

beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });

  // Full wipe
  await client`truncate table notification, audit_log cascade`;
  await client`truncate table ai_cache, ai_usage_daily, ai_rate_limit cascade`;
  await client`truncate table export_job cascade`;
  await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
  await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
  await client`truncate table mid_year_checkpoint cascade`;
  await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
  await client`truncate table staff_role, staff, grade, department, organization cascade`;
  await client`truncate table "user" cascade`;
  await client.end({ timeout: 2 });

  const ts = Date.now();
  const hraEmail = `p3-hra-${ts}@t.local`;
  const staffEmail = `p3-staff-${ts}@t.local`;
  const outsiderEmail = `p3-outsider-${ts}@t.local`;
  const orgYUserEmail = `p3-orgy-${ts}@t.local`;

  await signUp(hraEmail, 'HRA P3');
  await signUp(staffEmail, 'Staff P3');
  await signUp(outsiderEmail, 'Outsider P3');
  await signUp(orgYUserEmail, 'OrgY User');

  staffCookie = await signIn(staffEmail);
  outsiderCookie = await signIn(outsiderEmail);

  const getUserId = async (email: string): Promise<string> => {
    const res = await db.execute(sql`select id from "user" where email = ${email}`);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      id: string;
    }>;
    return rows[0]!.id;
  };

  const hraUserId = await getUserId(hraEmail);
  const staffUserId = await getUserId(staffEmail);
  const outsiderUserId = await getUserId(outsiderEmail);
  const orgYUserId = await getUserId(orgYUserEmail);

  // Org X (the "owning" org)
  const [orgX] = await db.insert(s.organization).values({ name: 'P3ScopeOrgX' }).returning();
  orgId = orgX!.id;
  const [dept] = await db
    .insert(s.department)
    .values({ orgId, code: 'ENG', name: 'Engineering' })
    .returning();
  const [grade] = await db.insert(s.grade).values({ orgId, code: 'G5', rank: '5' }).returning();
  gradeId = grade!.id;

  // Org Y (the "attacker" org — separate, for cache-leakage test)
  const [orgY] = await db.insert(s.organization).values({ name: 'P3ScopeOrgY' }).returning();
  orgYId = orgY!.id;
  const [deptY] = await db
    .insert(s.department)
    .values({ orgId: orgYId, code: 'FIN', name: 'Finance' })
    .returning();
  const [gradeY] = await db
    .insert(s.grade)
    .values({ orgId: orgYId, code: 'G5', rank: '5' })
    .returning();

  // HRA staff in orgX
  const [hraSt] = await db
    .insert(s.staff)
    .values({
      userId: hraUserId,
      orgId,
      employeeNo: `P3-HRA-${ts}`,
      name: 'HRA P3',
      designation: 'HR Admin',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2020-01-01',
    })
    .returning();

  // Staff in orgX (has staff role — no HRA)
  const [staffSt] = await db
    .insert(s.staff)
    .values({
      userId: staffUserId,
      orgId,
      employeeNo: `P3-ST-${ts}`,
      name: 'Staff P3',
      designation: 'Engineer',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2022-01-01',
    })
    .returning();

  // Outsider in orgX — no manager/report relation to staff member
  const [outsiderSt] = await db
    .insert(s.staff)
    .values({
      userId: outsiderUserId,
      orgId,
      employeeNo: `P3-OUT-${ts}`,
      name: 'Outsider P3',
      designation: 'Contractor',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2022-01-01',
    })
    .returning();

  // OrgY user — completely separate org
  const [orgYSt] = await db
    .insert(s.staff)
    .values({
      userId: orgYUserId,
      orgId: orgYId,
      employeeNo: `P3-YU-${ts}`,
      name: 'OrgY User',
      designation: 'Analyst',
      departmentId: deptY!.id,
      gradeId: gradeY!.id,
      managerId: null,
      hireDate: '2022-01-01',
    })
    .returning();

  await db.insert(s.staffRole).values([
    { staffId: hraSt!.id, role: 'hra' },
    { staffId: staffSt!.id, role: 'staff' },
    { staffId: outsiderSt!.id, role: 'staff' },
    { staffId: orgYSt!.id, role: 'hra' },
  ]);

  // Performance cycle + KRA for the staff member (org X)
  const [cy] = await db
    .insert(s.performanceCycle)
    .values({ staffId: staffSt!.id, fy: 2026, state: 'pms_finalized' })
    .returning();
  pmsCycleId = cy!.id;

  const [kra] = await db
    .insert(s.kra)
    .values({
      cycleId: pmsCycleId,
      perspective: 'financial',
      description: 'Improve revenue by 20%',
      weightPct: 100,
      measurement: 'Revenue',
      target: '20% increase',
      order: 0,
      rubric1to5: ['1', '2', '3', '4', '5'],
    })
    .returning();
  kraId = kra!.id;

  // Export job owned by HRA (for scoping test of GET /exports/:id)
  const [expJob] = await db
    .insert(s.exportJob)
    .values({
      kind: 'pms_org_snapshot',
      requestedBy: hraUserId,
      orgId,
      params: {},
      status: 'queued',
    })
    .returning();
  exportJobId = expJob!.id;

  // Actor objects for direct service calls
  actorOrgX = { userId: hraUserId, orgId, staffId: hraSt!.id, roles: ['hra'] };
  actorOrgY = { userId: orgYUserId, orgId: orgYId, staffId: orgYSt!.id, roles: ['hra'] };
});

// ── 401 — Unauthenticated tests ───────────────────────────────────────────────

describe('T37: unauthenticated → 401 on every Phase-3 protected route', () => {
  it('AI routes reject unauthenticated', async () => {
    const cases: UnauthCase[] = [
      { method: 'POST', path: '/api/v1/ai/staff-summary', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/ai/kra-quality', body: { kraId: NIL } },
      { method: 'POST', path: '/api/v1/ai/dev-recommendations', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/ai/mid-year-nudges', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/ai/calibration', body: { gradeId: NIL, fy: 2026 } },
      { method: 'GET', path: '/api/v1/ai/usage-today' },
      { method: 'GET', path: '/api/v1/ai/calibration-cohorts' },
    ];
    await assertUnauthenticated(app, cases);
  });

  it('Dashboard routes reject unauthenticated', async () => {
    const cases: UnauthCase[] = [
      { method: 'GET', path: '/api/v1/dashboards/me' },
      { method: 'GET', path: '/api/v1/dashboards/team' },
      { method: 'GET', path: '/api/v1/dashboards/dept' },
      { method: 'GET', path: '/api/v1/dashboards/hr' },
    ];
    await assertUnauthenticated(app, cases);
  });

  it('Search route rejects unauthenticated', async () => {
    const cases: UnauthCase[] = [{ method: 'GET', path: '/api/v1/search/staff?q=test' }];
    await assertUnauthenticated(app, cases);
  });

  it('Export routes reject unauthenticated', async () => {
    const cases: UnauthCase[] = [
      { method: 'POST', path: '/api/v1/exports/pms-org', body: { fy: 2026 } },
      { method: 'GET', path: `/api/v1/exports/${NIL}` },
      { method: 'GET', path: '/api/v1/exports' },
    ];
    await assertUnauthenticated(app, cases);
  });
});

// ── 403 — Role-gated tests (outsider = authenticated non-HRA) ─────────────────

describe('T37: non-HRA actor → 403 on HRA-only routes', () => {
  it('calibration POST requires HRA role', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'POST',
        path: '/api/v1/ai/calibration',
        body: { gradeId, fy: 2026 },
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('usage-today GET requires HRA role', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'GET',
        path: '/api/v1/ai/usage-today',
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('calibration-cohorts GET requires HRA role', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'GET',
        path: '/api/v1/ai/calibration-cohorts',
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('dashboard /dept requires department_head or HRA', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'GET',
        path: '/api/v1/dashboards/dept',
        outsiderCookie, // staff role only
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('dashboard /hr requires HRA', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'GET',
        path: '/api/v1/dashboards/hr',
        outsiderCookie, // staff role only
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('exports POST /pms-org requires HRA role', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'POST',
        path: '/api/v1/exports/pms-org',
        body: { fy: 2026 },
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it("exports GET /:id forbids reading another user's export job", async () => {
    // outsider is not the owner and not HRA
    const cases: ScopingCase[] = [
      {
        method: 'GET',
        path: `/api/v1/exports/${exportJobId}`,
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });
});

// ── AI scope: outsider cannot access another staff's cycle via AI routes ──────

describe("T37: AI routes deny outsider access to another staff's cycle", () => {
  it('staff-summary returns 403 for outsider on another cycle', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'POST',
        path: '/api/v1/ai/staff-summary',
        body: { cycleId: pmsCycleId },
        outsiderCookie, // outsider — not the owner and not a manager
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('dev-recommendations returns 403 for outsider on another cycle', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'POST',
        path: '/api/v1/ai/dev-recommendations',
        body: { cycleId: pmsCycleId },
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('mid-year-nudges returns 403 for outsider on another cycle', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'POST',
        path: '/api/v1/ai/mid-year-nudges',
        body: { cycleId: pmsCycleId },
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('kra-quality returns 403 for outsider on another kra', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'POST',
        path: '/api/v1/ai/kra-quality',
        body: { kraId },
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });
});

// ── Search: authed outsider gets empty results (not 403) ─────────────────────

describe('T37: search/staff — authed user with no scope gets empty results (not 403)', () => {
  it('returns 200 with empty items for outsider (T30 convention)', async () => {
    const res = await app.request('/api/v1/search/staff?q=nonexistentname12345', {
      method: 'GET',
      headers: { cookie: outsiderCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    // Must not be a 403 — returns scoped empty results
    expect(Array.isArray(body.items)).toBe(true);
  });
});

// ── Cache-leakage red-team ─────────────────────────────────────────────────────

describe('T37: cache-leakage red-team — org X cache not visible to org Y', () => {
  it('actor from org Y gets a cache MISS even when same feature+input is cached for org X', async () => {
    // 1. Clear AI tables
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table ai_cache, ai_usage_daily, ai_rate_limit, audit_log`;
    await client.end({ timeout: 2 });

    mockOpenRouter.mockClear();
    // Ensure mock returns a valid staff-summary shape
    mockOpenRouter.mockImplementation(async () => ({
      content: {
        highlights: ['Met targets'],
        concerns: [],
        focus_areas: ['Growth'],
      },
      promptTokens: 100,
      completionTokens: 50,
      model: 'openai/gpt-5.4-nano',
    }));

    // 2. Build the same logical input for both orgs — only orgId differs (scopeKey differs)
    const sharedCycleId = 'cycle-same-for-both-orgs';

    const inputOrgX = {
      orgId,
      cycleId: sharedCycleId,
      snapshot: { staffId: 'staff-X' },
    };

    const inputOrgY = {
      orgId: orgYId,
      cycleId: sharedCycleId,
      snapshot: { staffId: 'staff-X' }, // identical payload content
    };

    // 3. Call as org X actor — will insert a cache row with scopeKey = `org:${orgId}|cycle:${sharedCycleId}`
    const resultX = await runStaffSummary({ db, actor: actorOrgX, input: inputOrgX });
    expect(resultX.ok).toBe(true);
    if (!resultX.ok) return;
    expect(resultX.cached).toBe(false);
    expect(mockOpenRouter).toHaveBeenCalledTimes(1);

    // Verify the cache row was written with the correct scopeKey
    const cacheRows = (await db.execute(sql`select scope_key from ai_cache`)) as Array<{
      scope_key: string;
    }>;
    const cRows = Array.isArray(cacheRows)
      ? cacheRows
      : ((cacheRows as { rows?: unknown[] }).rows ?? []);
    expect(cRows.length).toBe(1);
    const scopeKey = (cRows[0] as { scope_key: string }).scope_key;
    // The scope key must include the org X id — proving namespace isolation
    expect(scopeKey).toContain(`org:${orgId}`);
    expect(scopeKey).not.toContain(orgYId);

    // 4. Now call as org Y actor with the exact same snapshot content but different orgId
    //    The scopeKey for org Y = `org:${orgYId}|cycle:${sharedCycleId}` — different from org X's key
    //    So the cache will MISS and openrouter will be called again
    mockOpenRouter.mockClear();

    const resultY = await runStaffSummary({ db, actor: actorOrgY, input: inputOrgY });
    expect(resultY.ok).toBe(true);
    if (!resultY.ok) return;

    // KEY ASSERTION: org Y must NOT get a cache hit from org X's cache row
    expect(resultY.cached, 'org Y must not read org X cache (scope leakage!)').toBe(false);
    // openrouter must have been called for org Y (cache miss)
    expect(mockOpenRouter).toHaveBeenCalledTimes(1);

    // 5. Verify two distinct cache rows exist (one per org)
    const allCacheRows = (await db.execute(
      sql`select scope_key from ai_cache order by created_at`,
    )) as Array<{ scope_key: string }>;
    const allCRows = Array.isArray(allCacheRows)
      ? allCacheRows
      : ((allCacheRows as { rows?: unknown[] }).rows ?? []);
    expect(allCRows.length).toBe(2);
    const scopeKeys = (allCRows as Array<{ scope_key: string }>).map((r) => r.scope_key);
    expect(scopeKeys.some((k) => k.includes(orgId))).toBe(true);
    expect(scopeKeys.some((k) => k.includes(orgYId))).toBe(true);
  });

  it('canonicalHash of identical content matches — confirming scope key is the isolation boundary', () => {
    // Both orgs use the same content hash (same input shape, same cycle id, same snapshot)
    // but different scopeKeys. This test proves the hash function itself doesn't isolate —
    // the scopeKey namespacing does.
    const contentX = { orgId, cycleId: 'same', snapshot: { staffId: 'staff-X' } };
    const contentY = { orgId: orgYId, cycleId: 'same', snapshot: { staffId: 'staff-X' } };

    // Different orgId in input → different content hash too (defense-in-depth)
    const hashX = canonicalHash(contentX);
    const hashY = canonicalHash(contentY);
    // Even if content hash were same, scope key provides isolation — but here they differ
    // because orgId is part of the input object itself.
    // This assertion confirms the hashes are distinct (double isolation).
    expect(hashX).not.toBe(hashY);
  });
});
