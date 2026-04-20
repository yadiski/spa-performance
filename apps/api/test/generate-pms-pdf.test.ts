process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { KraPerspective, NotificationKind } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import * as queue from '../src/jobs/queue';
import * as r2 from '../src/storage/r2';

const FAKE_SHA256 = `aabbcc${'0'.repeat(58)}`;
const putSpy = spyOn(r2, 'put').mockImplementation(async () => ({ sha256: FAKE_SHA256 }));
const bossSendSpy = spyOn(queue.boss, 'send').mockImplementation(
  async () => null as unknown as string,
);

import { runGeneratePmsPdf } from '../src/jobs/generate-pms-pdf';

describe('runGeneratePmsPdf', () => {
  afterAll(() => {
    putSpy.mockRestore();
    bossSendSpy.mockRestore();
  });

  let cycleId: string;
  let snapshotId: string;
  let staffStaffId: string;
  const actorId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    bossSendSpy.mockClear();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table notification, audit_log`;
    await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
    await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    const dims = await db.select().from(s.behaviouralDimension);
    if (dims.length === 0) {
      throw new Error('behavioural_dimension empty — run seed-behavioural-dims.ts first');
    }

    const [org] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, code: 'IT', name: 'IT' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'E10', rank: '10' })
      .returning();
    const [u] = await db.insert(s.user).values({ email: 'st@t', name: 'Staff' }).returning();
    const [st] = await db
      .insert(s.staff)
      .values({
        userId: u!.id,
        orgId: org!.id,
        employeeNo: 'S1',
        name: 'Staff',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2022-01-01',
      })
      .returning();
    staffStaffId = st!.id;

    const [cy] = await db
      .insert(s.performanceCycle)
      .values({ staffId: st!.id, fy: 2026, state: 'pms_finalized' })
      .returning();
    cycleId = cy!.id;

    const k1 = await db
      .insert(s.kra)
      .values({
        cycleId: cy!.id,
        perspective: KraPerspective.Financial,
        description: 'KRA 1',
        weightPct: 100,
        measurement: 'm',
        target: 't',
        order: 0,
        rubric1to5: ['a', 'b', 'c', 'd', 'e'],
      })
      .returning();

    const [pms] = await db.insert(s.pmsAssessment).values({ cycleId: cy!.id }).returning();
    await db.insert(s.pmsKraRating).values({
      pmsId: pms!.id,
      kraId: k1[0]!.id,
      resultAchieved: 'Good',
      finalRating: 4,
    });

    const [snap] = await db
      .insert(s.pmsFinalSnapshot)
      .values({
        pmsId: pms!.id,
        finalizedAt: new Date(),
        finalizedBy: actorId,
        scoreTotal: '3.00',
        scoreBreakdown: { kra: 2.8, behavioural: 0, contribution: 0, total: 3 },
      })
      .returning();
    snapshotId = snap!.id;
  });

  it('writes pdf_r2_key and pdf_sha256 onto the snapshot row', async () => {
    await runGeneratePmsPdf(db, cycleId, snapshotId, actorId);

    const [snap] = await db
      .select()
      .from(s.pmsFinalSnapshot)
      .where(eq(s.pmsFinalSnapshot.id, snapshotId));

    expect(snap?.pdfR2Key).toBe(`pms/${cycleId}/${snapshotId}.pdf`);
    expect(snap?.pdfSha256).toBe(FAKE_SHA256);
  });

  it('emits pms.pdf.generated audit event', async () => {
    await runGeneratePmsPdf(db, cycleId, snapshotId, actorId);

    const rows = await db.execute(
      sql`select event_type from audit_log where event_type = 'pms.pdf.generated'`,
    );
    const auditRows = (
      Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string }>;
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.event_type).toBe('pms.pdf.generated');
  });

  it('dispatches PmsPdfReady notification to appraisee', async () => {
    await runGeneratePmsPdf(db, cycleId, snapshotId, actorId);

    const notif = await db
      .select()
      .from(s.notification)
      .where(
        sql`recipient_staff_id = ${staffStaffId} and kind = ${NotificationKind.PmsPdfReady} and target_id = ${cycleId}`,
      );
    expect(notif.length).toBe(1);
    expect(notif[0]?.payload).toMatchObject({ cycleId, snapshotId });
  });
});
