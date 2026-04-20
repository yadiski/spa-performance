process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { KraPerspective, NotificationKind } from '@spa/shared';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { Actor } from '../src/auth/middleware';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { openMidYearWindow } from '../src/domain/cycle/windows';
import { ackMidYear, saveMidYearUpdate, submitMidYearUpdate } from '../src/domain/mid-year/service';
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

const validKra = (order: number, weight = 25) => ({
  perspective: KraPerspective.Financial,
  description: `KRA ${order + 1}`,
  weightPct: weight,
  measurement: 'm',
  target: 't',
  order,
  rubric1to5: ['a', 'b', 'c', 'd', 'e'],
});

describe('mid-year service', () => {
  let cycleId: string;
  let staffStaffId: string;
  let staffUserId: string;
  let mgrStaffId: string;
  let mgrUserId: string;
  let hraUserId: string;
  let kraIds: string[];

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
    const [mgrU] = await db.insert(s.user).values({ email: 'mgr@t', name: 'MGR' }).returning();
    const [stU] = await db.insert(s.user).values({ email: 'st@t', name: 'Staff' }).returning();
    hraUserId = hraU!.id;
    mgrUserId = mgrU!.id;
    staffUserId = stU!.id;

    const [hraSt] = await db
      .insert(s.staff)
      .values({
        userId: hraU!.id,
        orgId: o!.id,
        employeeNo: 'HRA1',
        name: 'HRA',
        designation: 'Head of HR',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    const [mgrSt] = await db
      .insert(s.staff)
      .values({
        userId: mgrU!.id,
        orgId: o!.id,
        employeeNo: 'MGR1',
        name: 'MGR',
        designation: 'Manager',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    mgrStaffId = mgrSt!.id;
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
        managerId: mgrSt!.id,
        hireDate: '2022-01-01',
      })
      .returning();
    staffStaffId = staffSt!.id;

    await db.insert(s.staffRole).values([
      { staffId: hraSt!.id, role: 'hra' },
      { staffId: mgrSt!.id, role: 'appraiser' },
      { staffId: staffSt!.id, role: 'staff' },
    ]);

    const [cy] = await db
      .insert(s.performanceCycle)
      .values({
        staffId: staffStaffId,
        fy: 2026,
        state: 'kra_approved',
      })
      .returning();
    cycleId = cy!.id;

    const k1 = await db
      .insert(s.kra)
      .values({ cycleId: cy!.id, ...validKra(0, 50) })
      .returning();
    const k2 = await db
      .insert(s.kra)
      .values({ cycleId: cy!.id, ...validKra(1, 50) })
      .returning();
    kraIds = [k1[0]!.id, k2[0]!.id];
  });

  it('openMidYearWindow transitions to MidYearOpen and creates checkpoint', async () => {
    const hraActor = mkActor({ userId: hraUserId, roles: ['hra'] });
    const r = await openMidYearWindow(db, hraActor, { cycleId });
    expect(r.ok).toBe(true);

    const [cy] = await db.select().from(s.performanceCycle).where(sql`id = ${cycleId}`);
    expect(cy?.state).toBe('mid_year_open');

    const checkpoints = await db
      .select()
      .from(s.midYearCheckpoint)
      .where(sql`cycle_id = ${cycleId}`);
    expect(checkpoints.length).toBe(1);
  });

  it('openMidYearWindow rejects non-HRA caller', async () => {
    const staff = mkActor({ userId: staffUserId, staffId: staffStaffId, roles: ['staff'] });
    const r = await openMidYearWindow(db, staff, { cycleId });
    expect(r.ok).toBe(false);
  });

  it('saveMidYearUpdate writes kra_progress_update rows', async () => {
    const hraActor = mkActor({ userId: hraUserId, roles: ['hra'] });
    await openMidYearWindow(db, hraActor, { cycleId });

    const staffActor = mkActor({ userId: staffUserId, staffId: staffStaffId, roles: ['staff'] });
    const r = await saveMidYearUpdate(db, staffActor, {
      cycleId,
      updates: [
        { kraId: kraIds[0]!, resultAchieved: '80% done', informalRating: 4 },
        { kraId: kraIds[1]!, resultAchieved: '60% done', informalRating: 3 },
      ],
      summary: 'On track',
    });
    expect(r.ok).toBe(true);

    const updates = await db.select().from(s.kraProgressUpdate);
    expect(updates.length).toBe(2);
    const [mid] = await db.select().from(s.midYearCheckpoint).where(sql`cycle_id = ${cycleId}`);
    expect(mid?.summary).toBe('On track');
  });

  it('saveMidYearUpdate rejects update with foreign kraId', async () => {
    const hraActor = mkActor({ userId: hraUserId, roles: ['hra'] });
    await openMidYearWindow(db, hraActor, { cycleId });

    const staffActor = mkActor({ userId: staffUserId, staffId: staffStaffId, roles: ['staff'] });
    const r = await saveMidYearUpdate(db, staffActor, {
      cycleId,
      updates: [
        { kraId: '00000000-0000-0000-0000-000000000000', resultAchieved: 'x', informalRating: 3 },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('happy path: open → save → submit → ack', async () => {
    const hraActor = mkActor({ userId: hraUserId, roles: ['hra'] });
    const staffActor = mkActor({ userId: staffUserId, staffId: staffStaffId, roles: ['staff'] });
    const mgrActor = mkActor({ userId: mgrUserId, staffId: mgrStaffId, roles: ['appraiser'] });

    await openMidYearWindow(db, hraActor, { cycleId });
    await saveMidYearUpdate(db, staffActor, {
      cycleId,
      updates: [{ kraId: kraIds[0]!, resultAchieved: 'done', informalRating: 4 }],
    });
    const submit = await submitMidYearUpdate(db, staffActor, { cycleId });
    expect(submit.ok).toBe(true);

    const [afterSubmit] = await db.select().from(s.performanceCycle).where(sql`id = ${cycleId}`);
    expect(afterSubmit?.state).toBe('mid_year_submitted');
    expect(afterSubmit?.midYearAt).not.toBeNull();

    const ack = await ackMidYear(db, mgrActor, { cycleId, note: 'looks good' });
    expect(ack.ok).toBe(true);

    const [afterAck] = await db.select().from(s.performanceCycle).where(sql`id = ${cycleId}`);
    expect(afterAck?.state).toBe('mid_year_done');

    const [mid] = await db.select().from(s.midYearCheckpoint).where(sql`cycle_id = ${cycleId}`);
    expect(mid?.submittedAt).not.toBeNull();
    expect(mid?.ackedAt).not.toBeNull();

    // audit chain: mid_year.opened, mid_year.saved, mid_year.submitted, mid_year.acked
    const auditRes = await db.execute(sql`
      select event_type from audit_log where target_id = ${cycleId} order by id asc
    `);
    const auditRows = (
      Array.isArray(auditRes) ? auditRes : ((auditRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string }>;
    expect(auditRows.map((r) => r.event_type)).toEqual([
      'mid_year.opened',
      'mid_year.saved',
      'mid_year.submitted',
      'mid_year.acked',
    ]);

    // Notification: MidYearOpened → appraisee
    const openedNotif = await db
      .select()
      .from(s.notification)
      .where(
        sql`recipient_staff_id = ${staffStaffId} and kind = ${NotificationKind.MidYearOpened} and target_id = ${cycleId}`,
      );
    expect(openedNotif.length).toBe(1);

    // Notification: MidYearSubmitted → appraiser (not appraisee)
    const submittedNotif = await db
      .select()
      .from(s.notification)
      .where(
        sql`recipient_staff_id = ${mgrStaffId} and kind = ${NotificationKind.MidYearSubmitted} and target_id = ${cycleId}`,
      );
    expect(submittedNotif.length).toBe(1);

    // Notification: MidYearAcked → appraisee
    const ackedNotif = await db
      .select()
      .from(s.notification)
      .where(
        sql`recipient_staff_id = ${staffStaffId} and kind = ${NotificationKind.MidYearAcked} and target_id = ${cycleId}`,
      );
    expect(ackedNotif.length).toBe(1);

    // No notification for mid_year.saved (drafts are noisy)
    const savedNotif = await db.select().from(s.notification).where(sql`kind = 'mid_year.saved'`);
    expect(savedNotif.length).toBe(0);
  });

  it('submit without any updates returns no_updates', async () => {
    const hraActor = mkActor({ userId: hraUserId, roles: ['hra'] });
    await openMidYearWindow(db, hraActor, { cycleId });

    const staffActor = mkActor({ userId: staffUserId, staffId: staffStaffId, roles: ['staff'] });
    const r = await submitMidYearUpdate(db, staffActor, { cycleId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_updates');
  });

  it('ackMidYear rejects non-manager caller', async () => {
    const hraActor = mkActor({ userId: hraUserId, roles: ['hra'] });
    const staffActor = mkActor({ userId: staffUserId, staffId: staffStaffId, roles: ['staff'] });
    await openMidYearWindow(db, hraActor, { cycleId });
    await saveMidYearUpdate(db, staffActor, {
      cycleId,
      updates: [{ kraId: kraIds[0]!, resultAchieved: 'done', informalRating: 4 }],
    });
    await submitMidYearUpdate(db, staffActor, { cycleId });

    const wrongActor = mkActor({
      userId: staffUserId,
      staffId: staffStaffId,
      roles: ['appraiser'],
    });
    const r = await ackMidYear(db, wrongActor, { cycleId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not_manager');
  });
});
