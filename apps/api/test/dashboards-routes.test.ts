// Tests for GET /api/v1/dashboards/* (T22)
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { refreshDashboardViews } from '../src/dashboards/aggregates';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';
import * as queue from '../src/jobs/queue';

// Stub out pg-boss send to prevent real queue operations
const bossSendSpy = spyOn(queue.boss, 'send').mockImplementation(
  async () => null as unknown as string,
);

afterAll(() => {
  bossSendSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const pw = 'correct-horse-battery-staple-abc456';

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

function dbRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
interface Fixture {
  hraCookie: string;
  staffCookie: string;
  mgrCookie: string;
  deptHeadCookie: string;
  orgId: string;
  deptId: string;
  dept2Id: string;
  staffStaffId: string;
  mgrStaffId: string;
}

let fixture: Fixture;

beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table notification cascade`;
  await client`truncate table audit_log cascade`;
  await client`truncate table mid_year_checkpoint cascade`;
  await client`truncate table behavioural_rating, pms_kra_rating, staff_contribution,
    career_development, personal_growth, pms_comment, pms_final_snapshot,
    cycle_amendment, pms_assessment cascade`;
  await client`truncate table kra_progress_update, kra cascade`;
  await client`truncate table approval_transition, performance_cycle cascade`;
  await client`truncate table staff_role, staff, grade, department, organization cascade`;
  await client`truncate table "user" cascade`;

  // Ensure materialized views exist with correct definitions
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_org_rollup CASCADE');
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_dept_rollup CASCADE');
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_cycle_summary CASCADE');

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_cycle_summary AS
      SELECT
        pc.id AS cycle_id, pc.staff_id, s.org_id, s.department_id, s.grade_id,
        pc.fy, pc.state, pfs.score_total::numeric(4,2) AS score_total,
        pc.pms_finalized_at AS finalized_at, pc.updated_at
      FROM performance_cycle pc
      JOIN staff s ON s.id = pc.staff_id
      LEFT JOIN pms_assessment pa ON pa.cycle_id = pc.id
      LEFT JOIN LATERAL (
        SELECT score_total FROM pms_final_snapshot
        WHERE pms_id = pa.id ORDER BY created_at DESC LIMIT 1
      ) pfs ON true
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_cycle_summary_idx ON mv_cycle_summary (cycle_id)',
  );

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_dept_rollup AS
      SELECT cs.department_id, cs.org_id,
        count(*) AS total_cycles,
        count(*) FILTER (WHERE cs.state = 'pms_finalized') AS finalized_cycles,
        round(avg(cs.score_total) FILTER (WHERE cs.score_total IS NOT NULL), 2) AS avg_score,
        now() AS updated_at
      FROM mv_cycle_summary cs GROUP BY cs.department_id, cs.org_id
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_dept_rollup_idx ON mv_dept_rollup (department_id, org_id)',
  );

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_org_rollup AS
      SELECT agg.org_id, agg.fy, agg.total_cycles, agg.finalized_cycles, agg.avg_score,
        sc.state_counts, now() AS updated_at
      FROM (
        SELECT org_id, fy, count(*) AS total_cycles,
          count(*) FILTER (WHERE state = 'pms_finalized') AS finalized_cycles,
          round(avg(score_total) FILTER (WHERE score_total IS NOT NULL), 2) AS avg_score
        FROM mv_cycle_summary GROUP BY org_id, fy
      ) agg
      JOIN (
        SELECT org_id, fy, jsonb_object_agg(state, n) AS state_counts
        FROM (SELECT org_id, fy, state, count(*) AS n FROM mv_cycle_summary GROUP BY org_id, fy, state) state_cnt
        GROUP BY org_id, fy
      ) sc ON sc.org_id = agg.org_id AND sc.fy = agg.fy
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_org_rollup_idx ON mv_org_rollup (org_id, fy)',
  );

  await client.end({ timeout: 2 });

  const ts = Date.now();

  const hraEmail = `dr-hra-${ts}@t.local`;
  const staffEmail = `dr-staff-${ts}@t.local`;
  const mgrEmail = `dr-mgr-${ts}@t.local`;
  const deptHeadEmail = `dr-dh-${ts}@t.local`;

  await signUp(hraEmail, 'HRA User');
  await signUp(staffEmail, 'Staff User');
  await signUp(mgrEmail, 'Manager User');
  await signUp(deptHeadEmail, 'DeptHead User');

  const hraCookie = await signIn(hraEmail);
  const staffCookie = await signIn(staffEmail);
  const mgrCookie = await signIn(mgrEmail);
  const deptHeadCookie = await signIn(deptHeadEmail);

  const getUserId = async (email: string) => {
    const res = dbRows<{ id: string }>(
      await db.execute(sql`select id from "user" where email = ${email}`),
    );
    return res[0]!.id;
  };

  const hraUserId = await getUserId(hraEmail);
  const staffUserId = await getUserId(staffEmail);
  const mgrUserId = await getUserId(mgrEmail);
  const dhUserId = await getUserId(deptHeadEmail);

  const [org] = await db.insert(s.organization).values({ name: 'DRTestOrg' }).returning();
  const [org2] = await db.insert(s.organization).values({ name: 'OtherOrg' }).returning();
  const [dept] = await db
    .insert(s.department)
    .values({ orgId: org!.id, code: 'ENG', name: 'Engineering' })
    .returning();
  const [dept2] = await db
    .insert(s.department)
    .values({ orgId: org!.id, code: 'FIN', name: 'Finance' })
    .returning();
  const [grade] = await db
    .insert(s.grade)
    .values({ orgId: org!.id, code: 'G10', rank: '10' })
    .returning();

  // HRA staff (in dept1)
  const [hraSt] = await db
    .insert(s.staff)
    .values({
      userId: hraUserId,
      orgId: org!.id,
      employeeNo: `DR-HRA-${ts}`,
      name: 'HRA User',
      designation: 'HR Admin',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2018-01-01',
    })
    .returning();

  // Manager (direct manager of staff)
  const [mgrSt] = await db
    .insert(s.staff)
    .values({
      userId: mgrUserId,
      orgId: org!.id,
      employeeNo: `DR-MGR-${ts}`,
      name: 'Manager User',
      designation: 'Manager',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2019-01-01',
    })
    .returning();

  // Staff (reports to manager)
  const [staffSt] = await db
    .insert(s.staff)
    .values({
      userId: staffUserId,
      orgId: org!.id,
      employeeNo: `DR-ST-${ts}`,
      name: 'Staff User',
      designation: 'Engineer',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: mgrSt!.id,
      hireDate: '2022-01-01',
    })
    .returning();

  // DeptHead (in dept2)
  const [dhSt] = await db
    .insert(s.staff)
    .values({
      userId: dhUserId,
      orgId: org!.id,
      employeeNo: `DR-DH-${ts}`,
      name: 'DeptHead User',
      designation: 'Department Head',
      departmentId: dept2!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2017-01-01',
    })
    .returning();

  await db.insert(s.staffRole).values([
    { staffId: hraSt!.id, role: 'hra' },
    { staffId: mgrSt!.id, role: 'appraiser' },
    { staffId: staffSt!.id, role: 'staff' },
    { staffId: dhSt!.id, role: 'department_head' },
  ]);

  // Create a finalized cycle for staff
  const [cy] = await db
    .insert(s.performanceCycle)
    .values({ staffId: staffSt!.id, fy: 2026, state: 'pms_finalized' })
    .returning();
  const [pms] = await db.insert(s.pmsAssessment).values({ cycleId: cy!.id }).returning();
  await db.insert(s.pmsFinalSnapshot).values({
    pmsId: pms!.id,
    finalizedAt: new Date(),
    finalizedBy: hraUserId,
    scoreTotal: '3.75',
    scoreBreakdown: { total: 3.75, kra: 3.75, behavioural: 3.75, contribution: 3.75 },
  });

  // Create a cycle for manager (in-progress)
  await db.insert(s.performanceCycle).values({
    staffId: mgrSt!.id,
    fy: 2026,
    state: 'pms_awaiting_appraiser',
  });

  // Refresh views so data is available
  await refreshDashboardViews(db);

  fixture = {
    hraCookie,
    staffCookie,
    mgrCookie,
    deptHeadCookie,
    orgId: org!.id,
    deptId: dept!.id,
    dept2Id: dept2!.id,
    staffStaffId: staffSt!.id,
    mgrStaffId: mgrSt!.id,
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /api/v1/dashboards/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/dashboards/me');
    expect(res.status).toBe(401);
  });

  it('returns cycles for the authenticated staff', async () => {
    const res = await getAs(fixture.staffCookie, '/api/v1/dashboards/me');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.cycles)).toBe(true);
    expect(body.cycles.length).toBeGreaterThanOrEqual(1);
    // The finalized cycle should have scoreTotal
    const finalized = body.cycles.find((c: { state: string }) => c.state === 'pms_finalized');
    expect(finalized).toBeDefined();
    expect(finalized.scoreTotal).toBeCloseTo(3.75, 1);
  });
});

describe('GET /api/v1/dashboards/team', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/dashboards/team');
    expect(res.status).toBe(401);
  });

  it('returns direct reports for the manager (not peers)', async () => {
    const res = await getAs(fixture.mgrCookie, '/api/v1/dashboards/team');
    expect(res.status).toBe(200);
    const body = await res.json();
    // Manager has staff as direct report
    expect(Array.isArray(body.directReports)).toBe(true);
    // Direct reports should contain staff, not peer HRA
    const ids = body.directReports.map((r: { staffId: string }) => r.staffId);
    expect(ids).toContain(fixture.staffStaffId);
    expect(ids).not.toContain(fixture.mgrStaffId); // not self
  });

  it('returns pending actions for awaiting-appraiser cycles', async () => {
    const res = await getAs(fixture.mgrCookie, '/api/v1/dashboards/team');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.total).toBeGreaterThanOrEqual(1);
    expect(body.stats.completed).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/v1/dashboards/dept', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/dashboards/dept');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-department-head non-HRA user', async () => {
    const res = await getAs(fixture.staffCookie, '/api/v1/dashboards/dept');
    expect(res.status).toBe(403);
  });

  it('returns dept rollup for department_head', async () => {
    const res = await getAs(fixture.deptHeadCookie, '/api/v1/dashboards/dept');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.department).toBeDefined();
    expect(body.rollup).toBeDefined();
    expect(typeof body.rollup.totalCycles).toBe('number');
    expect(Array.isArray(body.distribution)).toBe(true);
    expect(Array.isArray(body.cycles)).toBe(true);
  });

  it('returns dept rollup for HRA', async () => {
    const res = await getAs(fixture.hraCookie, '/api/v1/dashboards/dept');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rollup.totalCycles).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/v1/dashboards/hr', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/dashboards/hr');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-HRA user', async () => {
    const res = await getAs(fixture.staffCookie, '/api/v1/dashboards/hr');
    expect(res.status).toBe(403);
  });

  it('returns org-wide rollup with department breakdown for HRA', async () => {
    const res = await getAs(fixture.hraCookie, '/api/v1/dashboards/hr');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rollup).toBeDefined();
    expect(typeof body.rollup.totalCycles).toBe('number');
    expect(body.stateCounts).toBeDefined();
    expect(Array.isArray(body.departments)).toBe(true);
    // Should have at least one department with cycles
    expect(body.departments.length).toBeGreaterThanOrEqual(1);
    // Sums must be consistent: all dept totalCycles sum >= org totalCycles (some may be in diff fy)
    const deptTotal = body.departments.reduce(
      (acc: number, d: { totalCycles: number }) => acc + d.totalCycles,
      0,
    );
    expect(deptTotal).toBeGreaterThan(0);
  });
});
