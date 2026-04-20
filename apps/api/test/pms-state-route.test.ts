process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';

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

describe('GET /api/v1/pms/behavioural-dimensions', () => {
  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/pms/behavioural-dimensions');
    expect(res.status).toBe(401);
  });

  it('returns rubric catalogue for any authenticated user', async () => {
    const email = `dim-test-${Date.now()}@t.local`;
    await signUp(email, 'DimTester');
    const cookie = await signIn(email);

    const res = await getAs(cookie, '/api/v1/pms/behavioural-dimensions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      items: Array<{
        code: string;
        title: string;
        description: string;
        order: number;
        anchors: string[];
      }>;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);

    const first = body.items[0]!;
    expect(typeof first.code).toBe('string');
    expect(typeof first.title).toBe('string');
    expect(typeof first.description).toBe('string');
    expect(typeof first.order).toBe('number');
    expect(Array.isArray(first.anchors)).toBe(true);
    expect(first.anchors.length).toBe(5);

    // Items should be ordered by `order` ascending
    for (let i = 1; i < body.items.length; i++) {
      expect(body.items[i]!.order).toBeGreaterThanOrEqual(body.items[i - 1]!.order);
    }
  });
});

describe('GET /api/v1/pms/:cycleId/state', () => {
  let hraCookie: string;
  let staffCookie: string;
  let outsiderCookie: string;
  let cycleId: string;
  let staffStaffId: string;
  let hraStaffId: string;

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
    await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
    await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization cascade`;
    await client`truncate table "user" cascade`;
    await client.end({ timeout: 2 });

    const hraEmail = `hra-state-${Date.now()}@t.local`;
    const staffEmail = `staff-state-${Date.now()}@t.local`;
    const outsiderEmail = `outsider-state-${Date.now()}@t.local`;

    await signUp(hraEmail, 'HRA State');
    await signUp(staffEmail, 'Staff State');
    await signUp(outsiderEmail, 'Outsider State');

    hraCookie = await signIn(hraEmail);
    staffCookie = await signIn(staffEmail);
    outsiderCookie = await signIn(outsiderEmail);

    // Resolve user ids
    const hraRes = await db.execute(sql`select id from "user" where email = ${hraEmail}`);
    const hraRows = (
      Array.isArray(hraRes) ? hraRes : ((hraRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const hraUserId = hraRows[0]!.id;

    const staffRes = await db.execute(sql`select id from "user" where email = ${staffEmail}`);
    const staffRows = (
      Array.isArray(staffRes) ? staffRes : ((staffRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const staffUserId = staffRows[0]!.id;

    const outsiderRes = await db.execute(sql`select id from "user" where email = ${outsiderEmail}`);
    const outsiderRows = (
      Array.isArray(outsiderRes) ? outsiderRes : ((outsiderRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const outsiderUserId = outsiderRows[0]!.id;

    const [org] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, code: 'IT', name: 'IT' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'E10', rank: '10' })
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
    hraStaffId = hraSt!.id;

    const [staffSt] = await db
      .insert(s.staff)
      .values({
        userId: staffUserId,
        orgId: org!.id,
        employeeNo: 'ST1',
        name: 'Staff',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2022-01-01',
      })
      .returning();
    staffStaffId = staffSt!.id;

    const [outsiderSt] = await db
      .insert(s.staff)
      .values({
        userId: outsiderUserId,
        orgId: org!.id,
        employeeNo: 'OUT1',
        name: 'Outsider',
        designation: 'Contractor',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2022-01-01',
      })
      .returning();

    await db.insert(s.staffRole).values([
      { staffId: hraSt!.id, role: 'hra' },
      { staffId: staffSt!.id, role: 'staff' },
      { staffId: outsiderSt!.id, role: 'staff' },
    ]);

    const [cy] = await db
      .insert(s.performanceCycle)
      .values({ staffId: staffStaffId, fy: 2026, state: 'pms_self_review' })
      .returning();
    cycleId = cy!.id;
  });

  it('returns 401 without auth', async () => {
    const res = await app.request(`/api/v1/pms/${cycleId}/state`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown cycleId', async () => {
    const res = await getAs(hraCookie, '/api/v1/pms/00000000-0000-0000-0000-000000000000/state');
    expect(res.status).toBe(404);
  });

  it('returns 403 for outsider (unrelated staff)', async () => {
    const res = await getAs(outsiderCookie, `/api/v1/pms/${cycleId}/state`);
    expect(res.status).toBe(403);
  });

  it('returns state with null pms when no assessment exists yet (HRA)', async () => {
    const res = await getAs(hraCookie, `/api/v1/pms/${cycleId}/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cycle: { id: string; state: string; staffId: string; fy: number };
      pms: null;
      kraRatings: unknown[];
      behavioural: unknown[];
      contributions: unknown[];
      career: null;
      growth: null;
      comments: unknown[];
    };
    expect(body.cycle.id).toBe(cycleId);
    expect(body.cycle.state).toBe('pms_self_review');
    expect(body.pms).toBeNull();
    expect(body.kraRatings).toEqual([]);
    expect(body.behavioural).toEqual([]);
    expect(body.contributions).toEqual([]);
    expect(body.career).toBeNull();
    expect(body.growth).toBeNull();
    expect(body.comments).toEqual([]);
  });

  it('returns state with pms data when assessment exists (staff can see their own cycle)', async () => {
    // Seed pms_assessment + some data
    const [pms] = await db.insert(s.pmsAssessment).values({ cycleId }).returning();
    const pmsId = pms!.id;

    // Insert a KRA + rating
    const [k] = await db
      .insert(s.kra)
      .values({
        cycleId,
        perspective: 'financial',
        description: 'Grow revenue',
        weightPct: 100,
        measurement: 'Revenue',
        target: '1M',
        order: 0,
        rubric1to5: ['a', 'b', 'c', 'd', 'e'],
      })
      .returning();
    await db.insert(s.pmsKraRating).values({
      pmsId,
      kraId: k!.id,
      resultAchieved: 'Achieved target',
      finalRating: 4,
    });

    // Insert behavioural rating
    await db.insert(s.behaviouralRating).values({
      pmsId,
      dimensionCode: 'communication_skills',
      rating1to5: 3,
      rubricAnchorText: 'some anchor',
    });

    // Insert contribution
    await db
      .insert(s.staffContribution)
      .values({ pmsId, whenDate: 'Jan 2026', achievement: 'Mentored 3 juniors', weightPct: 2 });

    // Insert career + growth
    await db
      .insert(s.careerDevelopment)
      .values({ pmsId, potentialWindow: 'now', comments: 'Ready now' });
    await db
      .insert(s.personalGrowth)
      .values({ pmsId, trainingNeeds: 'Python advanced', comments: 'Focus on data' });

    // Insert comment
    await db.insert(s.pmsComment).values({ pmsId, role: 'appraisee', body: 'My self comment' });

    // Staff accesses their own cycle
    const res = await getAs(staffCookie, `/api/v1/pms/${cycleId}/state`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      cycle: { id: string; state: string };
      pms: { id: string };
      kraRatings: Array<{
        kraId: string;
        finalRating: number | null;
        resultAchieved: string | null;
      }>;
      behavioural: Array<{ dimensionCode: string; rating: number; anchorText: string }>;
      contributions: Array<{
        id: string;
        whenDate: string;
        achievement: string;
        weightPct: number;
      }>;
      career: { potentialWindow: string; notes: string | null } | null;
      growth: { goals: string | null; notes: string | null } | null;
      comments: Array<{ role: string; body: string }>;
    };

    expect(body.pms).not.toBeNull();
    expect(body.pms.id).toBe(pmsId);

    expect(body.kraRatings.length).toBe(1);
    expect(body.kraRatings[0]!.kraId).toBe(k!.id);
    expect(body.kraRatings[0]!.finalRating).toBe(4);
    expect(body.kraRatings[0]!.resultAchieved).toBe('Achieved target');

    expect(body.behavioural.length).toBe(1);
    expect(body.behavioural[0]!.dimensionCode).toBe('communication_skills');
    expect(body.behavioural[0]!.rating).toBe(3);

    expect(body.contributions.length).toBe(1);
    expect(body.contributions[0]!.achievement).toBe('Mentored 3 juniors');
    expect(body.contributions[0]!.weightPct).toBe(2);

    expect(body.career).not.toBeNull();
    expect(body.career!.potentialWindow).toBe('now');
    expect(body.career!.notes).toBe('Ready now');

    expect(body.growth).not.toBeNull();
    expect(body.growth!.goals).toBe('Python advanced');

    expect(body.comments.length).toBe(1);
    expect(body.comments[0]!.role).toBe('appraisee');
    expect(body.comments[0]!.body).toBe('My self comment');
  });
});
