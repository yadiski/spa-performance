process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { writeAudit } from '../src/audit/log';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';

const PW = 'audit-verify-horse-battery-staple';

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

describe('GET /api/v1/admin/audit/verify', () => {
  let hraCookie: string;
  let staffCookie: string;

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
    await client`truncate table staff_role, staff, grade, department, organization cascade`;
    await client`truncate table "user" cascade`;
    await client.end({ timeout: 2 });

    const ts = Date.now();
    const hraEmail = `hra-verify-${ts}@t.local`;
    const staffEmail = `staff-verify-${ts}@t.local`;

    await signUp(hraEmail, 'HRA Verify');
    await signUp(staffEmail, 'Staff Verify');

    hraCookie = await signIn(hraEmail);
    staffCookie = await signIn(staffEmail);

    // Get user IDs
    const hraUserRes = (
      Array.isArray(await db.execute(sql`select id from "user" where email = ${hraEmail}`))
        ? await db.execute(sql`select id from "user" where email = ${hraEmail}`)
        : ((
            (await db.execute(sql`select id from "user" where email = ${hraEmail}`)) as {
              rows?: unknown[];
            }
          ).rows ?? [])
    ) as Array<{ id: string }>;
    const staffUserRes = (
      Array.isArray(await db.execute(sql`select id from "user" where email = ${staffEmail}`))
        ? await db.execute(sql`select id from "user" where email = ${staffEmail}`)
        : ((
            (await db.execute(sql`select id from "user" where email = ${staffEmail}`)) as {
              rows?: unknown[];
            }
          ).rows ?? [])
    ) as Array<{ id: string }>;

    const [org] = await db.insert(s.organization).values({ name: 'VerifyOrg' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, code: 'V', name: 'V' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'G1', rank: '1' })
      .returning();

    const [hraSt] = await db
      .insert(s.staff)
      .values({
        userId: hraUserRes[0]!.id,
        orgId: org!.id,
        employeeNo: `VHR-${ts}`,
        name: 'HRA Verify',
        designation: 'HR',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    await db.insert(s.staffRole).values({ staffId: hraSt!.id, role: 'hra' });

    const [staffSt] = await db
      .insert(s.staff)
      .values({
        userId: staffUserRes[0]!.id,
        orgId: org!.id,
        employeeNo: `VST-${ts}`,
        name: 'Staff Verify',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2022-01-01',
      })
      .returning();
    await db.insert(s.staffRole).values({ staffId: staffSt!.id, role: 'staff' });
  });

  it('returns 401 when unauthenticated', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await app.request(`/api/v1/admin/audit/verify?from=${today}&to=${today}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin staff user', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await app.request(`/api/v1/admin/audit/verify?from=${today}&to=${today}`, {
      headers: { cookie: staffCookie },
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when from/to params are missing', async () => {
    const res = await app.request('/api/v1/admin/audit/verify', {
      headers: { cookie: hraCookie },
    });
    expect(res.status).toBe(400);
  });

  it('returns { ok: true } for HRA when chain is valid', async () => {
    // Write a valid chain
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'test.verify.route',
        actorId: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        payload: { x: 1 },
        ip: null,
        ua: null,
      });
    });

    const today = new Date().toISOString().slice(0, 10);
    const res = await app.request(`/api/v1/admin/audit/verify?from=${today}&to=${today}`, {
      headers: { cookie: hraCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns { ok: false } when chain has been tampered with', async () => {
    // Insert a row with a broken hash directly
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const today = new Date().toISOString().slice(0, 10);

    await client`
      insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
      values (
        now(), 'tampered.event', null, null, null, null, '{}'::jsonb, null, null,
        decode(repeat('00', 32), 'hex'),
        decode(repeat('ff', 32), 'hex'),
        decode(repeat('ff', 32), 'hex')
      )
    `;
    await client`
      insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
      values (
        now(), 'second.event', null, null, null, null, '{}'::jsonb, null, null,
        decode(repeat('00', 32), 'hex'),
        decode(repeat('ee', 32), 'hex'),
        decode(repeat('ee', 32), 'hex')
      )
    `;
    await client.end({ timeout: 2 });

    const res = await app.request(`/api/v1/admin/audit/verify?from=${today}&to=${today}`, {
      headers: { cookie: hraCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; firstFailureAt?: string; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.firstFailureAt).toBeTruthy();
    expect(body.reason).toBeTruthy();
  });
});
