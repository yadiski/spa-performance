process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
setDefaultTimeout(30_000);
import { NotificationKind } from '@spa/shared';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { dispatchNotifications } from '../src/domain/notifications/dispatch';

describe('dispatchNotifications', () => {
  let staffId1: string;
  let staffId2: string;
  let staffId3: string;

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table notification, audit_log, pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_final_snapshot, cycle_amendment, pms_assessment, mid_year_checkpoint, approval_transition, kra_progress_update, kra, performance_cycle, staff_role, staff, grade, department, organization, "user" cascade`;
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

    const [u1] = await db.insert(s.user).values({ email: 'staff1@t', name: 'Staff1' }).returning();
    const [u2] = await db.insert(s.user).values({ email: 'staff2@t', name: 'Staff2' }).returning();
    const [u3] = await db.insert(s.user).values({ email: 'staff3@t', name: 'Staff3' }).returning();

    const [st1] = await db
      .insert(s.staff)
      .values({
        userId: u1!.id,
        orgId: o!.id,
        employeeNo: 'S001',
        name: 'Staff1',
        designation: 'Engineer',
        departmentId: d!.id,
        gradeId: g!.id,
        hireDate: '2022-01-01',
      })
      .returning();
    const [st2] = await db
      .insert(s.staff)
      .values({
        userId: u2!.id,
        orgId: o!.id,
        employeeNo: 'S002',
        name: 'Staff2',
        designation: 'Engineer',
        departmentId: d!.id,
        gradeId: g!.id,
        hireDate: '2022-01-01',
      })
      .returning();
    const [st3] = await db
      .insert(s.staff)
      .values({
        userId: u3!.id,
        orgId: o!.id,
        employeeNo: 'S003',
        name: 'Staff3',
        designation: 'Engineer',
        departmentId: d!.id,
        gradeId: g!.id,
        hireDate: '2022-01-01',
      })
      .returning();

    staffId1 = st1!.id;
    staffId2 = st2!.id;
    staffId3 = st3!.id;
  });

  it('single recipient: writes one row with correct fields', async () => {
    const cycleId = '11111111-1111-1111-1111-111111111111';
    const payload = { cycleId, note: 'hello' };

    await db.transaction(async (tx) => {
      const result = await dispatchNotifications(tx, {
        kind: NotificationKind.PmsSelfReviewSubmitted,
        payload,
        recipients: [{ staffId: staffId1 }],
        targetType: 'cycle',
        targetId: cycleId,
      });
      expect(result).toEqual({ inserted: 1 });
    });

    const rows = await db
      .select()
      .from(s.notification)
      .where(eq(s.notification.recipientStaffId, staffId1));

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('pms.self_review.submitted');
    expect(row.payload).toEqual(payload);
    expect(row.recipientStaffId).toBe(staffId1);
    expect(row.targetType).toBe('cycle');
    expect(row.targetId).toBe(cycleId);
    expect(row.readAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('multi-recipient fan-out: 3 recipients → 3 rows, same kind/payload/target but distinct staffId', async () => {
    const cycleId = '22222222-2222-2222-2222-222222222222';
    const payload = { cycleId };

    await db.transaction(async (tx) => {
      const result = await dispatchNotifications(tx, {
        kind: NotificationKind.PmsFinalized,
        payload,
        recipients: [{ staffId: staffId1 }, { staffId: staffId2 }, { staffId: staffId3 }],
        targetType: 'pms',
        targetId: cycleId,
      });
      expect(result).toEqual({ inserted: 3 });
    });

    const rows = await db.select().from(s.notification);
    expect(rows).toHaveLength(3);

    const recipientIds = rows.map((r) => r.recipientStaffId).sort();
    expect(recipientIds).toEqual([staffId1, staffId2, staffId3].sort());

    for (const row of rows) {
      expect(row.kind).toBe('pms.finalized');
      expect(row.payload).toEqual(payload);
      expect(row.targetType).toBe('pms');
      expect(row.targetId).toBe(cycleId);
      expect(row.readAt).toBeNull();
    }
  });

  it('empty recipients: returns { inserted: 0 } and writes no rows', async () => {
    await db.transaction(async (tx) => {
      const result = await dispatchNotifications(tx, {
        kind: NotificationKind.MidYearSubmitted,
        payload: {},
        recipients: [],
      });
      expect(result).toEqual({ inserted: 0 });
    });

    const rows = await db.select().from(s.notification);
    expect(rows).toHaveLength(0);
  });

  it('runs inside caller-supplied transaction: rows visible after commit', async () => {
    const payload = { test: true };

    const result = await db.transaction((tx) =>
      dispatchNotifications(tx, {
        kind: NotificationKind.MidYearAcked,
        payload,
        recipients: [{ staffId: staffId1 }],
        targetType: 'mid_year',
        targetId: 'some-cycle-id',
      }),
    );

    expect(result).toEqual({ inserted: 1 });

    const rows = await db.select().from(s.notification);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('mid_year.acked');
    expect(rows[0]!.payload).toEqual(payload);
  });
});
