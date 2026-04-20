process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeEach, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
setDefaultTimeout(30_000);
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import * as queue from '../src/jobs/queue';

const bossSendSpy = spyOn(queue.boss, 'send').mockImplementation(
  async () => null as unknown as string,
);

afterAll(() => {
  bossSendSpy.mockRestore();
});

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

async function req(cookie: string, path: string, method = 'GET'): Promise<Response> {
  return app.request(path, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
  });
}

const pw = 'correct-horse-battery-staple-123';

describe('Notifications API', () => {
  let cookieA: string;
  let cookieB: string;
  let staffIdA: string;
  let staffIdB: string;
  let notifIdA1: string;
  let notifIdA2: string;
  let notifIdB1: string;

  beforeEach(async () => {
    bossSendSpy.mockClear();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table notification, audit_log, pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_final_snapshot, cycle_amendment, pms_assessment, mid_year_checkpoint, approval_transition, kra_progress_update, kra, performance_cycle, staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    const ts = Date.now();
    const emailA = `notif-a-${ts}@t.local`;
    const emailB = `notif-b-${ts}@t.local`;

    await signUp(emailA, 'User A', pw);
    await signUp(emailB, 'User B', pw);
    cookieA = await signIn(emailA, pw);
    cookieB = await signIn(emailB, pw);

    const [org] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, code: 'IT', name: 'IT' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'E10', rank: '10' })
      .returning();

    const uARes = await db.execute(sql`select id from "user" where email = ${emailA}`);
    const uBRes = await db.execute(sql`select id from "user" where email = ${emailB}`);

    const uARows = (
      Array.isArray(uARes) ? uARes : ((uARes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const uBRows = (
      Array.isArray(uBRes) ? uBRes : ((uBRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;

    const [stA] = await db
      .insert(s.staff)
      .values({
        userId: uARows[0]!.id,
        orgId: org!.id,
        employeeNo: `NA${ts}`,
        name: 'User A',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        hireDate: '2022-01-01',
      })
      .returning();

    const [stB] = await db
      .insert(s.staff)
      .values({
        userId: uBRows[0]!.id,
        orgId: org!.id,
        employeeNo: `NB${ts}`,
        name: 'User B',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        hireDate: '2022-01-01',
      })
      .returning();

    await db.insert(s.staffRole).values([
      { staffId: stA!.id, role: 'staff' },
      { staffId: stB!.id, role: 'staff' },
    ]);

    staffIdA = stA!.id;
    staffIdB = stB!.id;

    const notifs = await db
      .insert(s.notification)
      .values([
        {
          recipientStaffId: staffIdA,
          kind: 'pms.finalized',
          payload: { msg: 'a1' },
          targetType: 'cycle',
          targetId: '00000000-0000-0000-0000-000000000001',
          readAt: null,
        },
        {
          recipientStaffId: staffIdA,
          kind: 'pms.self_review.submitted',
          payload: { msg: 'a2' },
          targetType: null,
          targetId: null,
          readAt: new Date('2024-01-01T00:00:00Z'),
        },
        {
          recipientStaffId: staffIdB,
          kind: 'mid_year.opened',
          payload: { msg: 'b1' },
          targetType: null,
          targetId: null,
          readAt: null,
        },
      ])
      .returning();

    notifIdA1 = notifs[0]!.id;
    notifIdA2 = notifs[1]!.id;
    notifIdB1 = notifs[2]!.id;
  });

  describe('GET /api/v1/notifications (list)', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await app.request('/api/v1/notifications');
      expect(res.status).toBe(401);
    });

    it('returns only the actor own notifications', async () => {
      const res = await req(cookieA, '/api/v1/notifications');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      const ids = body.items.map((i) => i.id);
      expect(ids).toContain(notifIdA1);
      expect(ids).toContain(notifIdA2);
      expect(ids).not.toContain(notifIdB1);
    });

    it('respects unread=true filter — returns only unread', async () => {
      const res = await req(cookieA, '/api/v1/notifications?unread=true');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string; readAt: string | null }> };
      expect(body.items.every((i) => i.readAt === null)).toBe(true);
      const ids = body.items.map((i) => i.id);
      expect(ids).toContain(notifIdA1);
      expect(ids).not.toContain(notifIdA2);
    });

    it('respects limit param', async () => {
      const res = await req(cookieA, '/api/v1/notifications?limit=1');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items.length).toBe(1);
    });
  });

  describe('GET /api/v1/notifications/unread-count', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await app.request('/api/v1/notifications/unread-count');
      expect(res.status).toBe(401);
    });

    it('returns correct unread count for actor', async () => {
      const resA = await req(cookieA, '/api/v1/notifications/unread-count');
      expect(resA.status).toBe(200);
      const bodyA = (await resA.json()) as { count: number };
      expect(bodyA.count).toBe(1);

      const resB = await req(cookieB, '/api/v1/notifications/unread-count');
      expect(resB.status).toBe(200);
      const bodyB = (await resB.json()) as { count: number };
      expect(bodyB.count).toBe(1);
    });
  });

  describe('PATCH /api/v1/notifications/:id/read', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await app.request(`/api/v1/notifications/${notifIdA1}/read`, {
        method: 'PATCH',
      });
      expect(res.status).toBe(401);
    });

    it('marks a notification read and subsequent unread-count drops', async () => {
      const patchRes = await req(cookieA, `/api/v1/notifications/${notifIdA1}/read`, 'PATCH');
      expect(patchRes.status).toBe(200);
      const patchBody = (await patchRes.json()) as { ok: boolean; id: string };
      expect(patchBody.ok).toBe(true);
      expect(patchBody.id).toBe(notifIdA1);

      const countRes = await req(cookieA, '/api/v1/notifications/unread-count');
      const countBody = (await countRes.json()) as { count: number };
      expect(countBody.count).toBe(0);
    });

    it('is idempotent — marking already-read notification returns 200', async () => {
      const res = await req(cookieA, `/api/v1/notifications/${notifIdA2}/read`, 'PATCH');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });

    it('returns 404 when notification belongs to another actor (scoping check)', async () => {
      const res = await req(cookieB, `/api/v1/notifications/${notifIdA1}/read`, 'PATCH');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/notifications/read-all', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await app.request('/api/v1/notifications/read-all', { method: 'PATCH' });
      expect(res.status).toBe(401);
    });

    it('marks all unread notifications for actor as read and returns updated count', async () => {
      const res = await req(cookieA, '/api/v1/notifications/read-all', 'PATCH');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; updated: number };
      expect(body.ok).toBe(true);
      expect(body.updated).toBe(1);

      const countRes = await req(cookieA, '/api/v1/notifications/unread-count');
      const countBody = (await countRes.json()) as { count: number };
      expect(countBody.count).toBe(0);
    });

    it('leaves other actors notifications untouched', async () => {
      await req(cookieA, '/api/v1/notifications/read-all', 'PATCH');

      const countResB = await req(cookieB, '/api/v1/notifications/unread-count');
      const countBodyB = (await countResB.json()) as { count: number };
      expect(countBodyB.count).toBe(1);
    });
  });
});
