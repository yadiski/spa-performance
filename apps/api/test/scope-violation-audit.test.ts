/**
 * T11 — Cross-scope access attempt audit logging tests
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
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';
import * as queue from '../src/jobs/queue';

// Mock queue
spyOn(queue.boss, 'send').mockImplementation(async () => null as unknown as string);

const PW = 'correct-horse-battery-staple-T11scope!';

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

let outsiderCookie: string;
let pmsCycleId: string;

describe('scope violation audit events', () => {
  beforeAll(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table notification cascade`;
    await client`truncate table audit_log`;
    await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization cascade`;
    await client`truncate table "user" cascade`;
    await client.end({ timeout: 2 });

    const ts = Date.now();
    const ownerEmail = `scope-owner-t11-${ts}@t.local`;
    const outsiderEmail = `scope-outsider-t11-${ts}@t.local`;

    await signUp(ownerEmail, 'PMS Owner');
    await signUp(outsiderEmail, 'Outsider');
    outsiderCookie = await signIn(outsiderEmail);

    // Set up org/dept/grade/user/staff/cycle for owner
    const [org] = await db.insert(s.organization).values({ name: 'T11 Org' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, name: 'IT', code: 'IT' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'G1', rank: '1' })
      .returning();

    // Look up owner's user ID
    const ownerUserRes = await db.execute(sql`
      select id from "user" where email = ${ownerEmail} limit 1
    `);
    const ownerUserRows = (
      Array.isArray(ownerUserRes)
        ? ownerUserRes
        : ((ownerUserRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const ownerUserId = ownerUserRows[0]!.id;

    const [ownerStaff] = await db
      .insert(s.staff)
      .values({
        userId: ownerUserId,
        orgId: org!.id,
        employeeNo: `T11-E001-${ts}`,
        name: 'PMS Owner',
        designation: 'Staff',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();

    // Create a performance cycle for owner
    const [cycle] = await db
      .insert(s.performanceCycle)
      .values({
        staffId: ownerStaff!.id,
        fy: 2025,
        state: 'kra_drafting',
      })
      .returning();
    pmsCycleId = cycle!.id;
  });

  it('outsider GET /api/v1/pms/:cycleId/state returns 403', async () => {
    const res = await app.request(`/api/v1/pms/${pmsCycleId}/state`, {
      headers: { cookie: outsiderCookie },
    });
    expect(res.status).toBe(403);
  });

  it('outsider GET /api/v1/pms/:cycleId/state writes security.scope_violation audit event', async () => {
    // Clear previous audit events
    {
      const client = postgres(process.env.DATABASE_URL!, { max: 1 });
      await client`truncate table audit_log`;
      await client.end({ timeout: 2 });
    }

    const res = await app.request(`/api/v1/pms/${pmsCycleId}/state`, {
      headers: { cookie: outsiderCookie },
    });
    expect(res.status).toBe(403);

    // Give the async audit write a tick
    await new Promise((r) => setTimeout(r, 50));

    const auditRes = await db.execute(sql`
      select event_type, target_type, target_id, payload
      from audit_log
      where event_type = 'security.scope_violation'
      order by id desc
      limit 1
    `);
    const auditRows = (
      Array.isArray(auditRes) ? auditRes : ((auditRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string; target_type: string; target_id: string; payload: unknown }>;

    expect(auditRows[0]?.event_type).toBe('security.scope_violation');
    expect(auditRows[0]?.target_type).toBe('cycle');
    expect(auditRows[0]?.target_id).toBe(pmsCycleId);
  });

  it('non-HRA POST /api/v1/cycle/open-pms-bulk returns 403 + audit event', async () => {
    {
      const client = postgres(process.env.DATABASE_URL!, { max: 1 });
      await client`truncate table audit_log`;
      await client.end({ timeout: 2 });
    }

    const res = await app.request('/api/v1/cycle/open-pms-bulk', {
      method: 'POST',
      headers: { cookie: outsiderCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'org' }),
    });
    expect(res.status).toBe(403);

    await new Promise((r) => setTimeout(r, 50));

    const auditRes = await db.execute(sql`
      select event_type
      from audit_log
      where event_type = 'security.scope_violation'
      order by id desc
      limit 1
    `);
    const auditRows = (
      Array.isArray(auditRes) ? auditRes : ((auditRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string }>;
    expect(auditRows[0]?.event_type).toBe('security.scope_violation');
  });
});
