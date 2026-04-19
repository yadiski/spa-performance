process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it, beforeEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { app } from '../src/http/app';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { verifyChain } from '../src/audit/verifier';
import { KraPerspective } from '@spa/shared';

async function signUp(email: string, name: string, password: string): Promise<void> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (res.status !== 200) {
    throw new Error(`sign-up failed ${res.status}: ${await res.text()}`);
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`sign-in failed ${res.status}: ${await res.text()}`);
  }
  return res.headers.get('set-cookie') ?? '';
}

async function postAs(cookie: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function cleanDb(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table audit_log`;
  await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
  await client`truncate table staff_role, staff, grade, department, organization cascade`;
  await client`truncate table "user" cascade`;
  await client.end({ timeout: 2 });
}

describe('phase 1 acceptance', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('completes the full KRA happy path end-to-end', async () => {
    const [org] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, name: 'IT', code: 'IT' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'E10', rank: '10' })
      .returning();

    const mgrEmail = `mgr-${Date.now()}@t.local`;
    const staffEmail = `staff-${Date.now()}@t.local`;
    const pw = 'correct-horse-battery-staple-123';

    await signUp(mgrEmail, 'Manager Person', pw);
    await signUp(staffEmail, 'Staff Person', pw);

    const mgrUserResult = await db.execute(sql`select id from "user" where email = ${mgrEmail}`);
    const mgrUserRows = (Array.isArray(mgrUserResult) ? mgrUserResult : (mgrUserResult as { rows?: unknown[] }).rows ?? []) as Array<{ id: string }>;
    const staffUserResult = await db.execute(sql`select id from "user" where email = ${staffEmail}`);
    const staffUserRows = (Array.isArray(staffUserResult) ? staffUserResult : (staffUserResult as { rows?: unknown[] }).rows ?? []) as Array<{ id: string }>;

    const [mgrStaff] = await db.insert(s.staff).values({
      userId: mgrUserRows[0]!.id,
      orgId: org!.id,
      employeeNo: 'E100',
      name: 'Manager Person',
      designation: 'Manager',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2020-01-01',
    }).returning();
    const [staffRec] = await db.insert(s.staff).values({
      userId: staffUserRows[0]!.id,
      orgId: org!.id,
      employeeNo: 'E101',
      name: 'Staff Person',
      designation: 'Engineer',
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

    const submitRes = await app.request(`/api/v1/kra/submit/${cycle!.id}`, {
      method: 'POST',
      headers: { cookie: staffCookie },
    });
    expect(submitRes.status).toBe(200);

    const [afterSubmit] = await db.select().from(s.performanceCycle).where(sql`id = ${cycle!.id}`);
    expect(afterSubmit?.state).toBe('kra_pending_approval');

    const mgrCookie = await signIn(mgrEmail, pw);
    const approveRes = await postAs(mgrCookie, '/api/v1/kra/approve', {
      cycleId: cycle!.id,
    });
    expect(approveRes.status).toBe(200);

    const [afterApprove] = await db.select().from(s.performanceCycle).where(sql`id = ${cycle!.id}`);
    expect(afterApprove?.state).toBe('kra_approved');
    expect(afterApprove?.kraSetAt).not.toBeNull();

    const auditResult = await db.execute(sql`
      select event_type from audit_log
      where target_id = ${cycle!.id}
      order by id asc
    `);
    const auditRows = (Array.isArray(auditResult) ? auditResult : (auditResult as { rows?: unknown[] }).rows ?? []) as Array<{ event_type: string }>;
    const events = auditRows.map((r) => r.event_type);
    expect(events).toEqual(['kra.drafted', 'kra.submitted', 'kra.approved']);

    const today = new Date().toISOString().slice(0, 10);
    const verifyResult = await verifyChain(db, today, today);
    expect(verifyResult.ok).toBe(true);
  });

  it('reject path: rejects with note and returns cycle to kra_drafting', async () => {
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

    const mgrUserResult = await db.execute(sql`select id from "user" where email = ${mgrEmail}`);
    const mgrUserRows = (Array.isArray(mgrUserResult) ? mgrUserResult : (mgrUserResult as { rows?: unknown[] }).rows ?? []) as Array<{ id: string }>;
    const staffUserResult = await db.execute(sql`select id from "user" where email = ${staffEmail}`);
    const staffUserRows = (Array.isArray(staffUserResult) ? staffUserResult : (staffUserResult as { rows?: unknown[] }).rows ?? []) as Array<{ id: string }>;

    const [mgrStaff] = await db.insert(s.staff).values({
      userId: mgrUserRows[0]!.id,
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
      userId: staffUserRows[0]!.id,
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
        description: `KRA ${i + 1} description with enough text`,
        weightPct: i === 0 ? 40 : 30,
        measurement: 'measure',
        target: 'target',
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

    const [afterReject] = await db.select().from(s.performanceCycle).where(sql`id = ${cycle!.id}`);
    expect(afterReject?.state).toBe('kra_drafting');

    const transitionsResult = await db.execute(sql`
      select from_state, to_state, note from approval_transition
      where cycle_id = ${cycle!.id}
      order by at asc
    `);
    const transitions = (Array.isArray(transitionsResult) ? transitionsResult : (transitionsResult as { rows?: unknown[] }).rows ?? []) as Array<{
      from_state: string;
      to_state: string;
      note: string | null;
    }>;
    expect(transitions.length).toBe(2);
    expect(transitions[1]?.from_state).toBe('kra_pending_approval');
    expect(transitions[1]?.to_state).toBe('kra_drafting');
    expect(transitions[1]?.note).toBe('KRA 1 needs a measurable target');
  });
});
