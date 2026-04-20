process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import * as queue from '../src/jobs/queue';
import * as r2 from '../src/storage/r2';

const bossSendSpy = spyOn(queue.boss, 'send').mockImplementation(
  async () => null as unknown as string,
);
const getSignedUrlSpy = spyOn(r2, 'getSignedUrl').mockImplementation(
  async (key: string) => `https://cdn.example.com/${key}?sig=fake`,
);

import { app } from '../src/http/app';

const pw = 'horse-battery-staple-12345';

async function signUp(email: string, name: string, password: string): Promise<void> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed ${res.status}: ${await res.text()}`);
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed ${res.status}: ${await res.text()}`);
  return res.headers.get('set-cookie') ?? '';
}

async function postAs(cookie: string, path: string, body: unknown = {}): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getAs(cookie: string, path: string): Promise<Response> {
  return app.request(path, { headers: { cookie } });
}

describe('Export routes', () => {
  afterAll(() => {
    bossSendSpy.mockRestore();
    getSignedUrlSpy.mockRestore();
  });

  let hraCookie: string;
  let staffCookie: string;
  let hraUserId: string;
  let orgId: string;
  let hraStaffId: string;

  beforeEach(async () => {
    bossSendSpy.mockClear();
    getSignedUrlSpy.mockClear();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table notification, audit_log`;
    await client`truncate table export_job`;
    await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
    await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization cascade`;
    await client`truncate table "user" cascade`;
    await client.end({ timeout: 2 });

    const hraEmail = `hra-export-${Date.now()}@t.local`;
    const staffEmail = `staff-export-${Date.now()}@t.local`;

    await signUp(hraEmail, 'HRA', pw);
    await signUp(staffEmail, 'Staff', pw);

    hraCookie = await signIn(hraEmail, pw);
    staffCookie = await signIn(staffEmail, pw);

    // Resolve user ids
    const hraRes = await db.execute(sql`select id from "user" where email = ${hraEmail}`);
    const hraRows = (
      Array.isArray(hraRes) ? hraRes : ((hraRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    hraUserId = hraRows[0]!.id;

    const staffRes = await db.execute(sql`select id from "user" where email = ${staffEmail}`);
    const staffRows = (
      Array.isArray(staffRes) ? staffRes : ((staffRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const staffUserId = staffRows[0]!.id;

    const [org] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, code: 'HR', name: 'HR' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'G1', rank: '1' })
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
    await db.insert(s.staffRole).values({ staffId: hraSt!.id, role: 'hra' });

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
    await db.insert(s.staffRole).values({ staffId: staffSt!.id, role: 'staff' });
  });

  // ── POST /api/v1/exports/pms-org ─────────────────────────────────────────

  it('POST /pms-org returns 401 without auth', async () => {
    const res = await app.request('/api/v1/exports/pms-org', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('POST /pms-org returns 403 for non-HRA', async () => {
    const res = await postAs(staffCookie, '/api/v1/exports/pms-org', {});
    expect(res.status).toBe(403);
  });

  it('POST /pms-org creates a row and enqueues a job for HRA', async () => {
    const res = await postAs(hraCookie, '/api/v1/exports/pms-org', { fy: 2026 });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe('queued');
    expect(body.id).toBeTruthy();

    // Verify DB row
    const rows = await db.select().from(s.exportJob).where(sql`id = ${body.id}::uuid`);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('queued');
    expect((rows[0]?.params as Record<string, unknown>)?.fy).toBe(2026);

    // Verify boss.send was called
    expect(bossSendSpy).toHaveBeenCalledWith('exports.generate_xlsx', { exportJobId: body.id });
  });

  it('POST /pms-org works without fy param', async () => {
    const res = await postAs(hraCookie, '/api/v1/exports/pms-org', {});
    expect(res.status).toBe(201);
  });

  // ── GET /api/v1/exports/:id ───────────────────────────────────────────────

  it('GET /:id returns 401 without auth', async () => {
    const [job] = await db
      .insert(s.exportJob)
      .values({
        kind: 'pms_org_snapshot',
        requestedBy: hraUserId,
        orgId,
        params: {},
        status: 'queued',
      })
      .returning();

    const res = await app.request(`/api/v1/exports/${job!.id}`);
    expect(res.status).toBe(401);
  });

  it('GET /:id returns 403 for a user who is neither owner nor HRA', async () => {
    // Create a job owned by a third user
    const [thirdUser] = await db
      .insert(s.user)
      .values({ email: 'third@t.local', name: 'Third' })
      .returning();
    const [job] = await db
      .insert(s.exportJob)
      .values({
        kind: 'pms_org_snapshot',
        requestedBy: thirdUser!.id,
        orgId,
        params: {},
        status: 'queued',
      })
      .returning();

    // staffCookie is a staff user, not owner, not HRA
    const res = await getAs(staffCookie, `/api/v1/exports/${job!.id}`);
    expect(res.status).toBe(403);
  });

  it('GET /:id returns job status for requester', async () => {
    const [job] = await db
      .insert(s.exportJob)
      .values({
        kind: 'pms_org_snapshot',
        requestedBy: hraUserId,
        orgId,
        params: { fy: 2026 },
        status: 'queued',
      })
      .returning();

    const res = await getAs(hraCookie, `/api/v1/exports/${job!.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toBe(job!.id);
    expect(body.status).toBe('queued');
  });

  it('GET /:id returns signed URL when status is ready', async () => {
    const r2Key = `exports/pms-org/${orgId}/test-job.xlsx`;
    const [job] = await db
      .insert(s.exportJob)
      .values({
        kind: 'pms_org_snapshot',
        requestedBy: hraUserId,
        orgId,
        params: { fy: 2026 },
        status: 'ready',
        r2Key,
        sha256: 'abc123',
        rowCount: 5,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning();

    const res = await getAs(hraCookie, `/api/v1/exports/${job!.id}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; url: string; expiresAt: string };
    expect(body.status).toBe('ready');
    expect(body.url).toContain('https://cdn.example.com/');
    expect(body.url).toContain(r2Key);
    expect(body.expiresAt).toBeTruthy();

    // expiresAt should be ~24h from now
    const diff = new Date(body.expiresAt).getTime() - Date.now();
    expect(diff).toBeGreaterThan(86_390_000);
    expect(diff).toBeLessThanOrEqual(86_401_000);
  });

  // ── GET /api/v1/exports ───────────────────────────────────────────────────

  it('GET / returns 401 without auth', async () => {
    const res = await app.request('/api/v1/exports');
    expect(res.status).toBe(401);
  });

  it('GET / HRA sees all jobs', async () => {
    await db.insert(s.exportJob).values([
      {
        kind: 'pms_org_snapshot',
        requestedBy: hraUserId,
        orgId,
        params: {},
        status: 'queued',
      },
      {
        kind: 'pms_org_snapshot',
        requestedBy: hraUserId,
        orgId,
        params: {},
        status: 'ready',
      },
    ]);

    const res = await getAs(hraCookie, '/api/v1/exports');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items.length).toBe(2);
  });

  it('GET / staff user sees only their own jobs', async () => {
    // Create a job owned by HRA
    await db.insert(s.exportJob).values({
      kind: 'pms_org_snapshot',
      requestedBy: hraUserId,
      orgId,
      params: {},
      status: 'queued',
    });

    const res = await getAs(staffCookie, '/api/v1/exports');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    // Staff user has no jobs → empty list
    expect(body.items.length).toBe(0);
  });
});
