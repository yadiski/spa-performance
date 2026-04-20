process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import './setup';
import { afterAll, beforeEach, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
setDefaultTimeout(30_000);

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as openrouterMod from '../src/ai/core/openrouter';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';

// ── Stub callOpenRouter ──────────────────────────────────────────────────────
// Returns the correct output shape based on the system message content.

const mockCallOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(
  async (input) => {
    const model = input.model;
    const systemMsg = input.messages.find((m) => m.role === 'system')?.content ?? '';

    if (systemMsg.includes('SMART criteria') || systemMsg.includes('quality-assurance')) {
      return {
        content: { smart_score: 80, issues: [], suggested_rewrite: 'Improved KRA' },
        promptTokens: 100,
        completionTokens: 60,
        model,
      };
    }
    if (systemMsg.includes('calibration')) {
      return {
        content: { outliers: [], inconsistency_flags: [], talking_points: ['Good distribution'] },
        promptTokens: 100,
        completionTokens: 60,
        model,
      };
    }
    if (systemMsg.includes('mid-year') || systemMsg.includes('coaching')) {
      return {
        content: {
          per_kra_nudge: [{ kra_id: 'kra-1', nudge: 'Stay focused' }],
          overall_focus: 'Keep pushing',
        },
        promptTokens: 100,
        completionTokens: 60,
        model,
      };
    }
    if (
      systemMsg.includes('learning and development') ||
      systemMsg.includes('development recommendations')
    ) {
      return {
        content: { training: ['Course A'], stretch: ['Project X'], mentorship: ['Mentor Y'] },
        promptTokens: 100,
        completionTokens: 60,
        model,
      };
    }
    // Default: staff summary shape
    return {
      content: { highlights: ['Great Q2'], concerns: [], focus_areas: ['Time management'] },
      promptTokens: 100,
      completionTokens: 80,
      model,
    };
  },
);

afterAll(() => {
  mockCallOpenRouter.mockRestore();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const pw = 'correct-horse-battery-staple-xyz-9';

async function signUp(email: string, name: string): Promise<void> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw, name }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed ${res.status}: ${await res.text()}`);
}

async function signIn(email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed ${res.status}: ${await res.text()}`);
  return res.headers.get('set-cookie') ?? '';
}

async function post(cookie: string, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function get(cookie: string, path: string): Promise<Response> {
  return app.request(path, {
    method: 'GET',
    headers: { cookie },
  });
}

// ── Fixture state ────────────────────────────────────────────────────────────

let cookieHra: string;
let cookieStaff: string;
let cycleId: string;
let kraId: string;
let gradeId: string;
let orgId: string;

// ── beforeEach: seed a minimal org, HRA user, staff user, cycle, kra ─────────

beforeEach(async () => {
  mockCallOpenRouter.mockClear();

  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`
    truncate table ai_cache, ai_usage_daily, ai_rate_limit, audit_log,
    pms_comment, personal_growth, career_development, staff_contribution,
    behavioural_rating, pms_kra_rating, pms_final_snapshot, cycle_amendment,
    pms_assessment, mid_year_checkpoint, approval_transition, kra_progress_update,
    kra, performance_cycle, staff_role, staff, grade, department, organization, "user" cascade
  `;
  await client.end({ timeout: 2 });

  const ts = Date.now();
  const emailHra = `hra-ai-${ts}@t.local`;
  const emailStaff = `staff-ai-${ts}@t.local`;
  const emailOutsider = `outsider-ai-${ts}@t.local`;

  await signUp(emailHra, 'HRA User');
  await signUp(emailStaff, 'Staff User');
  await signUp(emailOutsider, 'Outsider');

  cookieHra = await signIn(emailHra);
  cookieStaff = await signIn(emailStaff);

  // Create org + department + grade
  const [org] = await db
    .insert(s.organization)
    .values({ name: `Org ${ts}` })
    .returning();
  orgId = org!.id;

  const [dept] = await db
    .insert(s.department)
    .values({ orgId, code: 'ENG', name: 'Engineering' })
    .returning();
  const [gradeRow] = await db.insert(s.grade).values({ orgId, code: 'G5', rank: '5' }).returning();
  gradeId = gradeRow!.id;

  // Look up user IDs
  const hraUserRes = await db.execute(sql`select id from "user" where email = ${emailHra}`);
  const staffUserRes = await db.execute(sql`select id from "user" where email = ${emailStaff}`);

  const hraRows = (
    Array.isArray(hraUserRes) ? hraUserRes : ((hraUserRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: string }>;
  const staffRows = (
    Array.isArray(staffUserRes) ? staffUserRes : ((staffUserRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: string }>;

  // Create staff records
  const [hraStaff] = await db
    .insert(s.staff)
    .values({
      userId: hraRows[0]!.id,
      orgId,
      employeeNo: `H${ts}`,
      name: 'HRA User',
      designation: 'HR Admin',
      departmentId: dept!.id,
      gradeId: gradeRow!.id,
      hireDate: '2020-01-01',
    })
    .returning();

  const [staffMember] = await db
    .insert(s.staff)
    .values({
      userId: staffRows[0]!.id,
      orgId,
      employeeNo: `S${ts}`,
      name: 'Staff User',
      designation: 'Engineer',
      departmentId: dept!.id,
      gradeId: gradeRow!.id,
      hireDate: '2022-01-01',
    })
    .returning();

  // Assign roles
  await db.insert(s.staffRole).values([
    { staffId: hraStaff!.id, role: 'hra' },
    { staffId: staffMember!.id, role: 'staff' },
  ]);

  // Create a performance cycle for staff member
  const [cycleRow] = await db
    .insert(s.performanceCycle)
    .values({
      staffId: staffMember!.id,
      fy: 2026,
      state: 'pms_finalized',
    })
    .returning();
  cycleId = cycleRow!.id;

  // Create a KRA for that cycle
  const [kraRow] = await db
    .insert(s.kra)
    .values({
      cycleId,
      perspective: 'financial',
      description: 'Increase revenue by 20%',
      weightPct: 40,
      measurement: 'Revenue growth',
      target: '20% increase',
      order: 0,
      rubric1to5: ['Very poor', 'Poor', 'Average', 'Good', 'Excellent'],
    })
    .returning();
  kraId = kraRow!.id;
});

// ── 401 tests (unauthenticated) ───────────────────────────────────────────────

describe('401 unauthenticated', () => {
  it('POST /staff-summary → 401', async () => {
    const res = await post('', '/api/v1/ai/staff-summary', { cycleId });
    expect(res.status).toBe(401);
  });

  it('POST /kra-quality → 401', async () => {
    const res = await post('', '/api/v1/ai/kra-quality', { kraId });
    expect(res.status).toBe(401);
  });

  it('POST /dev-recommendations → 401', async () => {
    const res = await post('', '/api/v1/ai/dev-recommendations', { cycleId });
    expect(res.status).toBe(401);
  });

  it('POST /calibration → 401', async () => {
    const res = await post('', '/api/v1/ai/calibration', { gradeId, fy: 2026 });
    expect(res.status).toBe(401);
  });

  it('POST /mid-year-nudges → 401', async () => {
    const res = await post('', '/api/v1/ai/mid-year-nudges', { cycleId });
    expect(res.status).toBe(401);
  });

  it('GET /usage-today → 401', async () => {
    const res = await get('', '/api/v1/ai/usage-today');
    expect(res.status).toBe(401);
  });
});

// ── 403 role-based tests ──────────────────────────────────────────────────────

describe('403 non-HRA on restricted routes', () => {
  it('POST /calibration → 403 for non-HRA', async () => {
    const res = await post(cookieStaff, '/api/v1/ai/calibration', { gradeId, fy: 2026 });
    expect(res.status).toBe(403);
  });

  it('GET /usage-today → 403 for non-HRA', async () => {
    const res = await get(cookieStaff, '/api/v1/ai/usage-today');
    expect(res.status).toBe(403);
  });
});

// ── Happy path tests ──────────────────────────────────────────────────────────

describe('happy path: HRA actor', () => {
  it('POST /staff-summary → 200 with output', async () => {
    const res = await post(cookieHra, '/api/v1/ai/staff-summary', { cycleId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      output: { highlights: string[]; concerns: string[]; focus_areas: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.output.highlights).toBeInstanceOf(Array);
    expect(body.output.concerns).toBeInstanceOf(Array);
    expect(body.output.focus_areas).toBeInstanceOf(Array);
  });

  it('POST /kra-quality → 200 with output', async () => {
    const res = await post(cookieHra, '/api/v1/ai/kra-quality', { kraId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      output: { smart_score: number; issues: string[]; suggested_rewrite: string };
    };
    expect(body.ok).toBe(true);
    expect(typeof body.output.smart_score).toBe('number');
    expect(body.output.issues).toBeInstanceOf(Array);
    expect(typeof body.output.suggested_rewrite).toBe('string');
  });

  it('POST /dev-recommendations → 200 with output', async () => {
    const res = await post(cookieHra, '/api/v1/ai/dev-recommendations', { cycleId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      output: { training: string[]; stretch: string[]; mentorship: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.output.training).toBeInstanceOf(Array);
    expect(body.output.stretch).toBeInstanceOf(Array);
    expect(body.output.mentorship).toBeInstanceOf(Array);
  });

  it('POST /calibration → 200 with output', async () => {
    const res = await post(cookieHra, '/api/v1/ai/calibration', { gradeId, fy: 2026 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      output: { outliers: string[]; inconsistency_flags: string[]; talking_points: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.output.outliers).toBeInstanceOf(Array);
    expect(body.output.inconsistency_flags).toBeInstanceOf(Array);
    expect(body.output.talking_points).toBeInstanceOf(Array);
  });

  it('POST /mid-year-nudges → 200 with output', async () => {
    const res = await post(cookieHra, '/api/v1/ai/mid-year-nudges', { cycleId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      output: { per_kra_nudge: unknown[]; overall_focus: string };
    };
    expect(body.ok).toBe(true);
    expect(body.output.per_kra_nudge).toBeInstanceOf(Array);
    expect(typeof body.output.overall_focus).toBe('string');
  });

  it('GET /usage-today → 200 with correct numbers', async () => {
    // Prime usage data
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const today = new Date().toISOString().slice(0, 10);
    await client`
      insert into ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      values (${orgId}::uuid, ${today}::date, 1200, 800, 3)
      on conflict (org_id, date) do update set
        prompt_tokens = 1200, completion_tokens = 800, requests = 3
    `;
    await client.end({ timeout: 2 });

    const res = await get(cookieHra, '/api/v1/ai/usage-today');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      promptTokens: number;
      completionTokens: number;
      requests: number;
      dailyCap: number;
      usagePct: number;
    };
    expect(body.promptTokens).toBe(1200);
    expect(body.completionTokens).toBe(800);
    expect(body.requests).toBe(3);
    expect(body.dailyCap).toBeGreaterThan(0);
    expect(body.usagePct).toBeGreaterThanOrEqual(0);
    expect(body.usagePct).toBeLessThanOrEqual(100);
  });
});

// ── Budget exhausted → 409 ────────────────────────────────────────────────────

describe('budget exhausted', () => {
  it('POST /staff-summary → 409 when budget is exhausted', async () => {
    // Prime usage to exceed cap
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const today = new Date().toISOString().slice(0, 10);
    await client`
      insert into ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      values (${orgId}::uuid, ${today}::date, 150000, 100000, 999)
      on conflict (org_id, date) do update set
        prompt_tokens = 150000, completion_tokens = 100000, requests = 999
    `;
    await client.end({ timeout: 2 });

    const res = await post(cookieHra, '/api/v1/ai/staff-summary', { cycleId });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ai_budget_exhausted');
  });
});

// ── Scoping gap: staff can't access another staff's cycle ─────────────────────

describe('403 scoping gap', () => {
  it('POST /staff-summary → 403 when staff actor cannot see the cycle', async () => {
    // staffMember has role=staff and their own cycle — but in this test
    // the cycle belongs to staffMember (which is the staff user themselves).
    // Instead, create a separate cycle for a different user that staff can't see:
    const ts2 = Date.now() + 1;
    const emailOther = `other-ai-${ts2}@t.local`;
    await signUp(emailOther, 'Other Staff');
    const cookieOther = await signIn(emailOther);

    // Other staff doesn't have a staff record → they can't see anyone's cycle
    // So using cookieStaff (who has a staff record but not manager role) trying to access
    // someone else's cycle should fail
    // Create a second cycle for a new staff with no manager relationship:
    const [dept2] = await db
      .insert(s.department)
      .values({ orgId, code: 'FIN', name: 'Finance' })
      .returning();
    const otherUserRes = await db.execute(sql`select id from "user" where email = ${emailOther}`);
    const otherRows = (
      Array.isArray(otherUserRes)
        ? otherUserRes
        : ((otherUserRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;

    const [otherStaff] = await db
      .insert(s.staff)
      .values({
        userId: otherRows[0]!.id,
        orgId,
        employeeNo: `OTH${ts2}`,
        name: 'Other Staff',
        designation: 'Analyst',
        departmentId: dept2!.id,
        gradeId,
        hireDate: '2023-01-01',
      })
      .returning();
    await db.insert(s.staffRole).values({ staffId: otherStaff!.id, role: 'staff' });

    const [otherCycle] = await db
      .insert(s.performanceCycle)
      .values({
        staffId: otherStaff!.id,
        fy: 2026,
        state: 'pms_finalized',
      })
      .returning();

    // cookieStaff (role=staff, not manager) cannot see otherCycle
    const res = await post(cookieStaff, '/api/v1/ai/staff-summary', { cycleId: otherCycle!.id });
    expect(res.status).toBe(403);
  });
});
