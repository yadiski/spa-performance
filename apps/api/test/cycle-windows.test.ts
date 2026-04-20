process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeEach, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
setDefaultTimeout(30_000);
import { NotificationKind } from '@spa/shared';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { Actor } from '../src/auth/middleware';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { openMidYearWindow, openPmsWindow } from '../src/domain/cycle/windows';
import * as queue from '../src/jobs/queue';

const bossSendSpy = spyOn(queue.boss, 'send').mockImplementation(
  async () => null as unknown as string,
);

afterAll(() => {
  bossSendSpy.mockRestore();
});

function mkActor(o: Partial<Actor>): Actor {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    staffId: null,
    roles: [],
    email: 'x@t',
    ip: null,
    ua: null,
    ...o,
  };
}

describe('cycle windows — notification wiring', () => {
  let cycleId: string;
  let staffStaffId: string;
  let hraUserId: string;

  beforeEach(async () => {
    bossSendSpy.mockClear();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table notification, audit_log`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    const [o] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [d] = await db
      .insert(s.department)
      .values({ orgId: o!.id, code: 'IT', name: 'IT' })
      .returning();
    const [g] = await db
      .insert(s.grade)
      .values({ orgId: o!.id, code: 'E10', rank: '10' })
      .returning();

    const [hraU] = await db.insert(s.user).values({ email: 'hra@t', name: 'HRA' }).returning();
    const [stU] = await db.insert(s.user).values({ email: 'st@t', name: 'Staff' }).returning();
    hraUserId = hraU!.id;

    const [hraSt] = await db
      .insert(s.staff)
      .values({
        userId: hraU!.id,
        orgId: o!.id,
        employeeNo: 'HRA1',
        name: 'HRA',
        designation: 'HR Admin',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    const [staffSt] = await db
      .insert(s.staff)
      .values({
        userId: stU!.id,
        orgId: o!.id,
        employeeNo: 'ST1',
        name: 'Staff',
        designation: 'Engineer',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2022-01-01',
      })
      .returning();
    staffStaffId = staffSt!.id;

    await db.insert(s.staffRole).values([
      { staffId: hraSt!.id, role: 'hra' },
      { staffId: staffSt!.id, role: 'staff' },
    ]);

    const [cy] = await db
      .insert(s.performanceCycle)
      .values({ staffId: staffStaffId, fy: 2026, state: 'kra_approved' })
      .returning();
    cycleId = cy!.id;
  });

  it('openMidYearWindow dispatches MidYearOpened to appraisee', async () => {
    const hraActor = mkActor({ userId: hraUserId, roles: ['hra'] });
    const r = await openMidYearWindow(db, hraActor, { cycleId });
    expect(r.ok).toBe(true);

    const notif = await db
      .select()
      .from(s.notification)
      .where(
        sql`recipient_staff_id = ${staffStaffId} and kind = ${NotificationKind.MidYearOpened} and target_id = ${cycleId}`,
      );
    expect(notif.length).toBe(1);
    expect(notif[0]?.targetType).toBe('cycle');
  });

  it('openPmsWindow does NOT dispatch any notification', async () => {
    // Advance to mid_year_done so openPmsWindow is valid
    await db.update(s.performanceCycle).set({ state: 'mid_year_done' }).where(sql`id = ${cycleId}`);

    const hraActor = mkActor({ userId: hraUserId, roles: ['hra'] });
    const r = await openPmsWindow(db, hraActor, { cycleId });
    expect(r.ok).toBe(true);

    const notifs = await db.select().from(s.notification);
    expect(notifs.length).toBe(0);
  });
});
