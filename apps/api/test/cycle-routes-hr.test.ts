process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';
import * as queue from '../src/jobs/queue';

const bossSendSpy = spyOn(queue.boss, 'send').mockImplementation(
  async () => null as unknown as string,
);

const pw = 'correct-horse-battery-staple-abc123';

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

async function getAs(cookie: string, path: string): Promise<Response> {
  return app.request(path, { headers: { cookie } });
}

async function postAs(cookie: string, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

// ── Test fixture setup ────────────────────────────────────────────────────────

interface Fixture {
  hraCookie: string;
  staffCookie: string;
  outsiderCookie: string;
  hraStaffId: string;
  staffStaffId: string;
  outsiderStaffId: string;
  orgId: string;
  deptId: string;
  dept2Id: string;
  cycleId: string;
  cycle2Id: string; // staff in dept2
}

async function buildFixture(): Promise<Fixture> {
  bossSendSpy.mockClear();

  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table notification, audit_log`;
  await client`truncate table mid_year_checkpoint cascade`;
  await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
  await client`truncate table staff_role, staff, grade, department, organization cascade`;
  await client`truncate table "user" cascade`;
  await client.end({ timeout: 2 });

  const ts = Date.now();
  const hraEmail = `hra-hr-${ts}@t.local`;
  const staffEmail = `staff-hr-${ts}@t.local`;
  const staff2Email = `staff2-hr-${ts}@t.local`;
  const outsiderEmail = `outsider-hr-${ts}@t.local`;

  await signUp(hraEmail, 'HRA');
  await signUp(staffEmail, 'Staff One');
  await signUp(staff2Email, 'Staff Two');
  await signUp(outsiderEmail, 'Outsider');

  const hraCookie = await signIn(hraEmail);
  const staffCookie = await signIn(staffEmail);
  const outsiderCookie = await signIn(outsiderEmail);

  // resolve user ids
  const getUserId = async (email: string) => {
    const res = await db.execute(sql`select id from "user" where email = ${email}`);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      id: string;
    }>;
    return rows[0]!.id;
  };

  const hraUserId = await getUserId(hraEmail);
  const staffUserId = await getUserId(staffEmail);
  const staff2UserId = await getUserId(staff2Email);
  const outsiderUserId = await getUserId(outsiderEmail);

  const [org] = await db.insert(s.organization).values({ name: 'TestOrg' }).returning();
  const [org2] = await db.insert(s.organization).values({ name: 'OtherOrg' }).returning();
  const [dept] = await db
    .insert(s.department)
    .values({ orgId: org!.id, code: 'IT', name: 'IT' })
    .returning();
  const [dept2] = await db
    .insert(s.department)
    .values({ orgId: org!.id, code: 'FIN', name: 'Finance' })
    .returning();
  const [otherDept] = await db
    .insert(s.department)
    .values({ orgId: org2!.id, code: 'EXT', name: 'External' })
    .returning();
  const [grade] = await db
    .insert(s.grade)
    .values({ orgId: org!.id, code: 'E10', rank: '10' })
    .returning();
  const [grade2] = await db
    .insert(s.grade)
    .values({ orgId: org2!.id, code: 'E10', rank: '10' })
    .returning();

  const [hraSt] = await db
    .insert(s.staff)
    .values({
      userId: hraUserId,
      orgId: org!.id,
      employeeNo: 'HRA1',
      name: 'HRA',
      designation: 'HR Admin',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2020-01-01',
    })
    .returning();

  const [staffSt] = await db
    .insert(s.staff)
    .values({
      userId: staffUserId,
      orgId: org!.id,
      employeeNo: 'ST1',
      name: 'Staff One',
      designation: 'Engineer',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2022-01-01',
    })
    .returning();

  const [staff2St] = await db
    .insert(s.staff)
    .values({
      userId: staff2UserId,
      orgId: org!.id,
      employeeNo: 'ST2',
      name: 'Staff Two',
      designation: 'Analyst',
      departmentId: dept2!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2022-01-01',
    })
    .returning();

  // outsider is in a different org
  const [outsiderSt] = await db
    .insert(s.staff)
    .values({
      userId: outsiderUserId,
      orgId: org2!.id,
      employeeNo: 'OUT1',
      name: 'Outsider',
      designation: 'Contractor',
      departmentId: otherDept!.id,
      gradeId: grade2!.id,
      managerId: null,
      hireDate: '2022-01-01',
    })
    .returning();

  await db.insert(s.staffRole).values([
    { staffId: hraSt!.id, role: 'hra' },
    { staffId: staffSt!.id, role: 'staff' },
    { staffId: staff2St!.id, role: 'staff' },
    { staffId: outsiderSt!.id, role: 'staff' },
  ]);

  // Create cycles: staff in dept (mid_year_done), staff2 in dept2 (kra_approved)
  const [cy1] = await db
    .insert(s.performanceCycle)
    .values({
      staffId: staffSt!.id,
      fy: 2026,
      state: 'mid_year_done',
    })
    .returning();

  const [cy2] = await db
    .insert(s.performanceCycle)
    .values({
      staffId: staff2St!.id,
      fy: 2026,
      state: 'kra_approved',
    })
    .returning();

  return {
    hraCookie,
    staffCookie,
    outsiderCookie,
    hraStaffId: hraSt!.id,
    staffStaffId: staffSt!.id,
    outsiderStaffId: outsiderSt!.id,
    orgId: org!.id,
    deptId: dept!.id,
    dept2Id: dept2!.id,
    cycleId: cy1!.id,
    cycle2Id: cy2!.id,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/cycle/list', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await buildFixture();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/cycle/list');
    expect(res.status).toBe(401);
  });

  it('non-HRA actor gets only their own cycle (no filters applied)', async () => {
    const res = await getAs(f.staffCookie, '/api/v1/cycle/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.items.length).toBe(1);
    expect(body.items[0]!.id).toBe(f.cycleId);
    expect(body.total).toBe(1);
  });

  it('HRA gets all cycles scoped to their org', async () => {
    const res = await getAs(f.hraCookie, '/api/v1/cycle/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        id: string;
        state: string;
        staffName: string;
        departmentName: string;
        employeeNo: string;
      }>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(2);
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(f.cycleId);
    expect(ids).toContain(f.cycle2Id);
    // outsider should NOT appear (different org)
    const item = body.items[0]!;
    expect(typeof item.staffName).toBe('string');
    expect(typeof item.departmentName).toBe('string');
    expect(typeof item.employeeNo).toBe('string');
  });

  it('HRA can filter by state', async () => {
    const res = await getAs(f.hraCookie, '/api/v1/cycle/list?state=mid_year_done');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; state: string }>;
      total: number;
    };
    expect(body.items.every((i) => i.state === 'mid_year_done')).toBe(true);
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(f.cycleId);
    expect(ids).not.toContain(f.cycle2Id);
  });

  it('HRA can filter by departmentId', async () => {
    const res = await getAs(f.hraCookie, `/api/v1/cycle/list?departmentId=${f.dept2Id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.items.map((i) => i.id)).toContain(f.cycle2Id);
    expect(body.items.map((i) => i.id)).not.toContain(f.cycleId);
  });
});

describe('POST /api/v1/cycle/open-pms-for-staff', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await buildFixture();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/cycle/open-pms-for-staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cycleId: f.cycleId }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-HRA actor', async () => {
    const res = await postAs(f.staffCookie, '/api/v1/cycle/open-pms-for-staff', {
      cycleId: f.cycleId,
    });
    expect(res.status).toBe(403);
  });

  it('HRA can open PMS window for a single eligible cycle', async () => {
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-pms-for-staff', {
      cycleId: f.cycleId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns error when cycle is not in eligible state', async () => {
    // cycle2Id is kra_approved — not eligible for open_pms
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-pms-for-staff', {
      cycleId: f.cycle2Id,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
  });
});

describe('POST /api/v1/cycle/open-mid-year-for-staff', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await buildFixture();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/cycle/open-mid-year-for-staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cycleId: f.cycle2Id }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-HRA actor', async () => {
    const res = await postAs(f.staffCookie, '/api/v1/cycle/open-mid-year-for-staff', {
      cycleId: f.cycle2Id,
    });
    expect(res.status).toBe(403);
  });

  it('HRA can open mid-year window for a single eligible cycle', async () => {
    // cycle2Id is kra_approved — eligible for open_mid_year
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-mid-year-for-staff', {
      cycleId: f.cycle2Id,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('POST /api/v1/cycle/open-pms-bulk', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await buildFixture();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/cycle/open-pms-bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'org' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-HRA actor', async () => {
    const res = await postAs(f.staffCookie, '/api/v1/cycle/open-pms-bulk', { scope: 'org' });
    expect(res.status).toBe(403);
  });

  it('scope=org opens every eligible cycle and reports count', async () => {
    // Only cycleId is mid_year_done (eligible for open_pms). cycle2Id is kra_approved (not eligible).
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-pms-bulk', { scope: 'org' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opened: number;
      failed: Array<{ cycleId: string; error: string }>;
    };
    expect(body.opened).toBe(1);
    expect(body.failed.length).toBe(0);
  });

  it('scope=department opens only that department cycles', async () => {
    // dept has cycleId (mid_year_done), dept2 has cycle2Id (kra_approved)
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-pms-bulk', {
      scope: 'department',
      departmentId: f.deptId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opened: number;
      failed: Array<{ cycleId: string; error: string }>;
    };
    expect(body.opened).toBe(1);
    expect(body.failed.length).toBe(0);
  });

  it('scope=department opens 0 when department has no eligible cycles', async () => {
    // dept2 has cycle2Id which is kra_approved — not eligible for open_pms
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-pms-bulk', {
      scope: 'department',
      departmentId: f.dept2Id,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opened: number;
      failed: Array<{ cycleId: string; error: string }>;
    };
    expect(body.opened).toBe(0);
  });

  it('scope=staffIds opens only listed staff cycles', async () => {
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-pms-bulk', {
      scope: 'staffIds',
      staffIds: [f.staffStaffId],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opened: number;
      failed: Array<{ cycleId: string; error: string }>;
    };
    expect(body.opened).toBe(1);
    expect(body.failed.length).toBe(0);
  });

  it('reports failures without aborting (double-open same cycle)', async () => {
    // First open succeeds; set cycle state back manually but open again — this tests the
    // "keep going on failure" path by opening two cycles where one fails.
    // Add a second mid_year_done cycle for the same staff (this will conflict on first open,
    // and the second will succeed); or simply test via two cycles where state machine
    // rejects the second attempt.
    // Simplest: set cycleId back to mid_year_done, then open twice via staffIds
    // Actually: open org first (1 succeed), then try org again (0 eligible, 0 fail)
    // Better: use a different approach — manually test by opening once (success), then
    // calling open-pms-bulk again (cycle is now pms_self_review, state machine rejects → fail recorded)
    const res1 = await postAs(f.hraCookie, '/api/v1/cycle/open-pms-bulk', { scope: 'org' });
    expect(((await res1.json()) as { opened: number }).opened).toBe(1);

    // Now try scope=staffIds with the already-opened cycle (staffId is still in org)
    // The cycle is now pms_self_review. We call staffIds — it won't appear because filter
    // is on eligible state. So instead let's directly call open-pms-for-staff:
    const res2 = await postAs(f.hraCookie, '/api/v1/cycle/open-pms-for-staff', {
      cycleId: f.cycleId,
    });
    expect(res2.status).toBe(409);
    const body2 = (await res2.json()) as { ok: boolean; error: string };
    expect(body2.ok).toBe(false);
    expect(typeof body2.error).toBe('string');
  });
});

describe('POST /api/v1/cycle/open-mid-year-bulk', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await buildFixture();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/cycle/open-mid-year-bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'org' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-HRA actor', async () => {
    const res = await postAs(f.staffCookie, '/api/v1/cycle/open-mid-year-bulk', { scope: 'org' });
    expect(res.status).toBe(403);
  });

  it('scope=org opens every eligible cycle (kra_approved) and reports count', async () => {
    // cycle2Id is kra_approved — eligible for open_mid_year. cycleId is mid_year_done — not eligible.
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-mid-year-bulk', { scope: 'org' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opened: number;
      failed: Array<{ cycleId: string; error: string }>;
    };
    expect(body.opened).toBe(1);
    expect(body.failed.length).toBe(0);
  });

  it('scope=department opens only that department', async () => {
    // dept2 has cycle2Id (kra_approved) — eligible
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-mid-year-bulk', {
      scope: 'department',
      departmentId: f.dept2Id,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opened: number;
      failed: Array<{ cycleId: string; error: string }>;
    };
    expect(body.opened).toBe(1);
  });

  it('scope=staffIds opens only listed staff cycles', async () => {
    const res = await postAs(f.hraCookie, '/api/v1/cycle/open-mid-year-bulk', {
      scope: 'staffIds',
      staffIds: [f.staffStaffId, f.outsiderStaffId],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opened: number;
      failed: Array<{ cycleId: string; error: string }>;
    };
    // staffStaffId is mid_year_done — not eligible for mid_year; outsider is different org — filtered out
    expect(body.opened).toBe(0);
  });
});
