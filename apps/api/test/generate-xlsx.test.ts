process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { NotificationKind } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import * as queue from '../src/jobs/queue';
import * as r2 from '../src/storage/r2';

const FAKE_SHA256 = `ccddee${'0'.repeat(58)}`;
const putSpy = spyOn(r2, 'put').mockImplementation(async () => ({ sha256: FAKE_SHA256 }));
const bossSendSpy = spyOn(queue.boss, 'send').mockImplementation(
  async () => null as unknown as string,
);

import { runGenerateXlsx } from '../src/jobs/generate-xlsx';

describe('runGenerateXlsx', () => {
  afterAll(() => {
    putSpy.mockRestore();
    bossSendSpy.mockRestore();
  });

  let orgId: string;
  let requesterUserId: string;
  let requesterStaffId: string;
  let exportJobId: string;

  beforeEach(async () => {
    putSpy.mockClear();
    bossSendSpy.mockClear();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table notification, audit_log`;
    await client`truncate table export_job`;
    await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
    await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    // Create org + dept + grade + users
    const [org] = await db.insert(s.organization).values({ name: 'TestOrg' }).returning();
    orgId = org!.id;
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, code: 'HR', name: 'HR Dept' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'G5', rank: '5' })
      .returning();

    // Requester (HRA)
    const [hraUser] = await db
      .insert(s.user)
      .values({ email: 'hra@test.local', name: 'HRA User' })
      .returning();
    requesterUserId = hraUser!.id;

    const [hraSt] = await db
      .insert(s.staff)
      .values({
        userId: hraUser!.id,
        orgId: org!.id,
        employeeNo: 'HRA01',
        name: 'HRA User',
        designation: 'HR Admin',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    requesterStaffId = hraSt!.id;
    await db.insert(s.staffRole).values({ staffId: hraSt!.id, role: 'hra' });

    // Create 3 finalized cycles for 3 different staff members
    for (let i = 1; i <= 3; i++) {
      const [u] = await db
        .insert(s.user)
        .values({ email: `staff${i}@test.local`, name: `Staff ${i}` })
        .returning();
      const [st] = await db
        .insert(s.staff)
        .values({
          userId: u!.id,
          orgId: org!.id,
          employeeNo: `S00${i}`,
          name: `Staff ${i}`,
          designation: 'Engineer',
          departmentId: dept!.id,
          gradeId: grade!.id,
          managerId: null,
          hireDate: '2022-01-01',
        })
        .returning();

      const [cy] = await db
        .insert(s.performanceCycle)
        .values({ staffId: st!.id, fy: 2026, state: 'pms_finalized' })
        .returning();

      const [pms] = await db.insert(s.pmsAssessment).values({ cycleId: cy!.id }).returning();

      await db.insert(s.pmsFinalSnapshot).values({
        pmsId: pms!.id,
        finalizedAt: new Date(),
        finalizedBy: hraUser!.id,
        scoreTotal: `${3 + i * 0.1}`,
        scoreBreakdown: { kra: 2.5, behavioural: 0.4, contribution: 0.1, total: 3 + i * 0.1 },
      });
    }

    // Create the export_job row
    const [job] = await db
      .insert(s.exportJob)
      .values({
        kind: 'pms_org_snapshot',
        requestedBy: requesterUserId,
        orgId: org!.id,
        params: { fy: 2026 },
        status: 'queued',
      })
      .returning();
    exportJobId = job!.id;
  });

  it('sets status=ready, sha256, row_count=3 on successful run', async () => {
    await runGenerateXlsx(db, exportJobId);

    const [job] = await db.select().from(s.exportJob).where(eq(s.exportJob.id, exportJobId));

    expect(job?.status).toBe('ready');
    expect(job?.sha256).toBeTruthy();
    expect(job?.rowCount).toBe(3);
    expect(job?.r2Key).toContain(`exports/pms-org/${orgId}/${exportJobId}.xlsx`);
    expect(job?.completedAt).toBeTruthy();
  });

  it('calls r2.put with a buffer and correct content-type', async () => {
    await runGenerateXlsx(db, exportJobId);

    expect(putSpy).toHaveBeenCalledTimes(1);
    const [key, bytes, contentType] = putSpy.mock.calls[0]!;
    expect(key).toContain('exports/pms-org/');
    expect(key).toContain('.xlsx');
    expect(bytes).toBeInstanceOf(Buffer);
    expect(contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('dispatches ExportReady notification to the requester', async () => {
    await runGenerateXlsx(db, exportJobId);

    const notif = await db
      .select()
      .from(s.notification)
      .where(
        sql`recipient_staff_id = ${requesterStaffId} and kind = ${NotificationKind.ExportReady}`,
      );
    expect(notif.length).toBe(1);
    expect((notif[0]?.payload as Record<string, unknown>)?.exportJobId).toBe(exportJobId);
  });

  it('is idempotent — skips if status is not queued', async () => {
    // Mark as running first
    await db.update(s.exportJob).set({ status: 'running' }).where(eq(s.exportJob.id, exportJobId));

    await runGenerateXlsx(db, exportJobId);

    // r2.put should NOT have been called
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('sets status=failed and propagates the error', async () => {
    // Override put to throw
    putSpy.mockImplementationOnce(async () => {
      throw new Error('R2 upload failed');
    });

    await expect(runGenerateXlsx(db, exportJobId)).rejects.toThrow('R2 upload failed');

    const [job] = await db.select().from(s.exportJob).where(eq(s.exportJob.id, exportJobId));

    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('R2 upload failed');
  });
});
