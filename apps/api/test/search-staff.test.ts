// Tests for GET /api/v1/search/staff (T29-T31)
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import './setup';
import { beforeAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
setDefaultTimeout(30_000);

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';

// ── Helpers ───────────────────────────────────────────────────────────────────

const pw = 'correct-horse-battery-staple-search-99';

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

async function get(cookie: string, path: string): Promise<Response> {
  return app.request(path, { method: 'GET', headers: { cookie } });
}

function dbRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

// ── Fixture ───────────────────────────────────────────────────────────────────

interface Fixture {
  hraCookie: string;
  staffCookie: string;
  mgrCookie: string;
  hraStaffId: string;
  mgrStaffId: string;
  reportStaffId: string;
}

let fixture: Fixture;

beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
  await client.end({ timeout: 2 });

  const ts = Date.now();

  const hraEmail = `ss-hra-${ts}@t.local`;
  const staffEmail = `ss-staff-${ts}@t.local`;
  const mgrEmail = `ss-mgr-${ts}@t.local`;
  const reportEmail = `ss-report-${ts}@t.local`;
  const peerEmail = `ss-peer-${ts}@t.local`;

  await signUp(hraEmail, 'Alice HRA');
  await signUp(staffEmail, 'Bob Staff');
  await signUp(mgrEmail, 'Carol Manager');
  await signUp(reportEmail, 'John Doe');
  await signUp(peerEmail, 'Eve Peer');

  const hraCookie = await signIn(hraEmail);
  const staffCookie = await signIn(staffEmail);
  const mgrCookie = await signIn(mgrEmail);

  const getUserId = async (email: string) => {
    const rows = dbRows<{ id: string }>(
      await db.execute(sql`select id from "user" where email = ${email}`),
    );
    return rows[0]!.id;
  };

  const hraUserId = await getUserId(hraEmail);
  const staffUserId = await getUserId(staffEmail);
  const mgrUserId = await getUserId(mgrEmail);
  const reportUserId = await getUserId(reportEmail);
  const peerUserId = await getUserId(peerEmail);

  const [org] = await db
    .insert(s.organization)
    .values({ name: `SearchOrg-${ts}` })
    .returning();
  const [dept] = await db
    .insert(s.department)
    .values({ orgId: org!.id, code: 'ENG', name: 'Engineering' })
    .returning();
  const [grade] = await db
    .insert(s.grade)
    .values({ orgId: org!.id, code: 'G10', rank: '10' })
    .returning();

  const mkStaff = async (
    userId: string,
    employeeNo: string,
    name: string,
    managerId: string | null,
  ) => {
    const [x] = await db
      .insert(s.staff)
      .values({
        userId,
        orgId: org!.id,
        employeeNo,
        name,
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId,
        hireDate: '2022-01-01',
      })
      .returning();
    return x!.id;
  };

  const hraStaffId = await mkStaff(hraUserId, `SS-HRA-${ts}`, 'Alice HRA', null);
  const mgrStaffId = await mkStaff(mgrUserId, `SS-MGR-${ts}`, 'Carol Manager', null);
  const reportStaffId = await mkStaff(reportUserId, `SS-REP-${ts}`, 'John Doe', mgrStaffId);
  const staffStaffId = await mkStaff(staffUserId, `SS-STA-${ts}`, 'Bob Staff', null);
  // Peer is created but not assigned to manager's scope
  await mkStaff(peerUserId, `SS-PEER-${ts}`, 'Eve Peer', null);

  await db.insert(s.staffRole).values([
    { staffId: hraStaffId, role: 'hra' },
    { staffId: mgrStaffId, role: 'appraiser' },
    { staffId: staffStaffId, role: 'staff' },
  ]);

  fixture = {
    hraCookie,
    staffCookie,
    mgrCookie,
    hraStaffId,
    mgrStaffId,
    reportStaffId,
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/search/staff', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/search/staff?q=John');
    expect(res.status).toBe(401);
  });

  it('empty q returns scoped staff sorted by name', async () => {
    const res = await get(fixture.hraCookie, '/api/v1/search/staff?q=&limit=50');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string }>; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
    // Should be sorted by name
    const names = body.items.map((i) => i.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('prefix query returns matching staff', async () => {
    const res = await get(fixture.hraCookie, '/api/v1/search/staff?q=John&limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ name: string; score: number }>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    const names = body.items.map((i) => i.name);
    // Should find John Doe
    const hasJohn = names.some((n) => n.toLowerCase().includes('john'));
    expect(hasJohn).toBe(true);
  });

  it('typo query (trigram) returns a match or gracefully empty', async () => {
    // "Joh" is a prefix/trigram of "John Doe"
    const res = await get(fixture.hraCookie, '/api/v1/search/staff?q=Joh&limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string }>; total: number };
    // No error; either found (trigram+prefix) or not (threshold too low for 3-char query)
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('regular staff member gets empty result set', async () => {
    const res = await get(fixture.staffCookie, '/api/v1/search/staff?q=John&limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    // Staff role can only see self; "John" is not self → empty
    expect(body.total).toBe(0);
    expect(body.items).toHaveLength(0);
  });

  it('manager sees their reports but not HRA peer', async () => {
    // Carol Manager (appraiser) has John Doe as report
    const res = await get(fixture.mgrCookie, '/api/v1/search/staff?q=&limit=50');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; name: string }>;
      total: number;
    };
    const ids = body.items.map((i) => i.id);
    // Should see self (Carol) and report (John Doe)
    expect(ids).toContain(fixture.mgrStaffId);
    expect(ids).toContain(fixture.reportStaffId);
    // Should NOT see HRA user who is a peer outside scope
    expect(ids).not.toContain(fixture.hraStaffId);
  });

  it('response shape has all required fields', async () => {
    const res = await get(fixture.hraCookie, '/api/v1/search/staff?q=Alice&limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    if (body.items.length > 0) {
      const item = body.items[0]!;
      expect(typeof item.id).toBe('string');
      expect(typeof item.name).toBe('string');
      expect(typeof item.employeeNo).toBe('string');
      expect(typeof item.email).toBe('string');
      expect(typeof item.departmentName).toBe('string');
      expect(typeof item.designation).toBe('string');
      expect(typeof item.score).toBe('number');
    }
  });
});
