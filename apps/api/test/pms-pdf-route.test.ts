process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';

// Stub r2.getSignedUrl so no real S3 call happens
mock.module('../src/storage/r2', () => ({
  put: mock(async () => ({ sha256: 'fake' })),
  getSignedUrl: mock(async (key: string) => `https://cdn.example.com/${key}?sig=fake`),
}));

import { app } from '../src/http/app';

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

async function getAs(cookie: string, path: string): Promise<Response> {
  return app.request(path, { headers: { cookie } });
}

describe('GET /api/v1/pms/:cycleId/pdf', () => {
  let cycleId: string;
  let snapshotId: string;
  let hraCookie: string;
  let outsiderCookie: string;
  const pw = 'correct-horse-battery-staple-123';

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

    const hraEmail = `hra-pdf-${Date.now()}@t.local`;
    const outsiderEmail = `outsider-pdf-${Date.now()}@t.local`;
    await signUp(hraEmail, 'HRA Person', pw);
    await signUp(outsiderEmail, 'Outsider', pw);

    hraCookie = await signIn(hraEmail, pw);
    outsiderCookie = await signIn(outsiderEmail, pw);

    // Resolve user ids from DB
    const hraUserRes = await db.execute(sql`select id from "user" where email = ${hraEmail}`);
    const hraUserRows = (
      Array.isArray(hraUserRes) ? hraUserRes : ((hraUserRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const hraUserId = hraUserRows[0]!.id;

    const outsiderUserRes = await db.execute(
      sql`select id from "user" where email = ${outsiderEmail}`,
    );
    const outsiderUserRows = (
      Array.isArray(outsiderUserRes)
        ? outsiderUserRes
        : ((outsiderUserRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const outsiderUserId = outsiderUserRows[0]!.id;

    const [org] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, code: 'IT', name: 'IT' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'E10', rank: '10' })
      .returning();

    // Staff user (the cycle owner)
    const [staffU] = await db
      .insert(s.user)
      .values({ email: `staff-pdf-${Date.now()}@t.local`, name: 'Staff' })
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
        hireDate: '2020-01-01',
      })
      .returning();

    const [staffSt] = await db
      .insert(s.staff)
      .values({
        userId: staffU!.id,
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

    await db.insert(s.staffRole).values([
      { staffId: hraSt!.id, role: 'hra' },
      { staffId: outsiderSt!.id, role: 'staff' },
      { staffId: staffSt!.id, role: 'staff' },
    ]);

    const [cy] = await db
      .insert(s.performanceCycle)
      .values({ staffId: staffSt!.id, fy: 2026, state: 'pms_finalized' })
      .returning();
    cycleId = cy!.id;

    const [pms] = await db.insert(s.pmsAssessment).values({ cycleId: cy!.id }).returning();

    const [snap] = await db
      .insert(s.pmsFinalSnapshot)
      .values({
        pmsId: pms!.id,
        finalizedAt: new Date(),
        finalizedBy: hraUserId,
        scoreTotal: '3.50',
        scoreBreakdown: { kra: 2.45, behavioural: 1.0, contribution: 0.05, total: 3.5 },
        pdfR2Key: `pms/${cy!.id}/snap-test.pdf`,
        pdfSha256: 'deadbeef',
      })
      .returning();
    snapshotId = snap!.id;
  });

  it('returns 401 without auth', async () => {
    const res = await app.request(`/api/v1/pms/${cycleId}/pdf`);
    expect(res.status).toBe(401);
  });

  it('happy path — HRA gets signed URL and expiresAt', async () => {
    const res = await getAs(hraCookie, `/api/v1/pms/${cycleId}/pdf`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expiresAt: string };
    expect(body.url).toContain('https://cdn.example.com/');
    expect(body.url).toContain('pms/');
    expect(body.expiresAt).toBeTruthy();
    // expiresAt should be ~24h from now
    const diff = new Date(body.expiresAt).getTime() - Date.now();
    expect(diff).toBeGreaterThan(86_390_000); // within 10s of 86400s
    expect(diff).toBeLessThanOrEqual(86_401_000);
  });

  it('returns 404 with PDF_NOT_READY when no pdf_r2_key set', async () => {
    // Create a fresh cycle without a pdf_r2_key snapshot
    const [staffU2] = await db
      .insert(s.user)
      .values({ email: `staff2-${Date.now()}@t.local`, name: 'Staff2' })
      .returning();
    const orgs = await db.select().from(s.organization).limit(1);
    const depts = await db.select().from(s.department).limit(1);
    const grades = await db.select().from(s.grade).limit(1);
    const [st2] = await db
      .insert(s.staff)
      .values({
        userId: staffU2!.id,
        orgId: orgs[0]!.id,
        employeeNo: 'ST2',
        name: 'Staff2',
        designation: 'Engineer',
        departmentId: depts[0]!.id,
        gradeId: grades[0]!.id,
        managerId: null,
        hireDate: '2022-01-01',
      })
      .returning();
    await db.insert(s.staffRole).values({ staffId: st2!.id, role: 'staff' });
    const [cy2] = await db
      .insert(s.performanceCycle)
      .values({ staffId: st2!.id, fy: 2026, state: 'pms_finalized' })
      .returning();
    const [pms2] = await db.insert(s.pmsAssessment).values({ cycleId: cy2!.id }).returning();
    await db.insert(s.pmsFinalSnapshot).values({
      pmsId: pms2!.id,
      finalizedAt: new Date(),
      finalizedBy: '00000000-0000-0000-0000-000000000001',
      scoreTotal: '3.00',
      scoreBreakdown: { kra: 2.1, behavioural: 0.75, contribution: 0.15, total: 3 },
    });

    const res = await getAs(hraCookie, `/api/v1/pms/${cy2!.id}/pdf`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('PDF_NOT_READY');
  });

  it('returns 403 when actor cannot see the cycle (unrelated staff member)', async () => {
    const res = await getAs(outsiderCookie, `/api/v1/pms/${cycleId}/pdf`);
    expect(res.status).toBe(403);
  });
});
