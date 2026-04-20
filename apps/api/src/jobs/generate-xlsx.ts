import { NotificationKind } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';
import { exportJob, staff, user } from '../db/schema';
import { dispatchNotifications } from '../domain/notifications/dispatch';
import { generatePmsOrgSnapshot } from '../exports/xlsx-pms-org';
import { put } from '../storage/r2';

export interface GenerateXlsxJob {
  exportJobId: string;
}

export async function runGenerateXlsx(db: DB, jobId: string): Promise<void> {
  // 1. Load the export_job row
  const [row] = await db.select().from(exportJob).where(eq(exportJob.id, jobId)).limit(1);

  if (!row) {
    throw new Error(`export_job not found: ${jobId}`);
  }

  // Idempotent: skip if not queued
  if (row.status !== 'queued') {
    return;
  }

  // 2. Mark as running
  await db
    .update(exportJob)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(exportJob.id, jobId));

  try {
    // 3. Generate the XLSX
    const params = (row.params ?? {}) as Record<string, unknown>;
    const fyValue = typeof params.fy === 'number' ? params.fy : undefined;

    const snapshotOpts: { orgId: string; fy?: number } = { orgId: row.orgId };
    if (fyValue !== undefined) snapshotOpts.fy = fyValue;

    const { bytes, rowCount, sha256 } = await generatePmsOrgSnapshot(db, snapshotOpts);

    // 4. Upload to R2
    const r2Key = `exports/pms-org/${row.orgId}/${jobId}.xlsx`;
    await put(r2Key, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // 5. Update row to ready
    await db
      .update(exportJob)
      .set({
        status: 'ready',
        r2Key,
        sha256,
        rowCount,
        completedAt: new Date(),
      })
      .where(eq(exportJob.id, jobId));

    // 6. Emit audit event + dispatch notification in a transaction
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'export.pms_org.generated',
        actorId: row.requestedBy,
        actorRole: 'hra',
        targetType: null,
        targetId: jobId,
        payload: { exportJobId: jobId, rowCount, sha256 },
        ip: null,
        ua: null,
      });

      // 7. Dispatch notification to requester — look up staffId via requestedBy (user.id)
      const staffRows = await tx
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.userId, row.requestedBy))
        .limit(1);

      const requesterStaffId = staffRows[0]?.id;
      if (requesterStaffId) {
        await dispatchNotifications(tx, {
          kind: NotificationKind.ExportReady,
          payload: {
            exportJobId: jobId,
            downloadPath: `/api/v1/exports/${jobId}`,
          },
          recipients: [{ staffId: requesterStaffId }],
        });
      }
    });
  } catch (err) {
    // 8. Mark as failed and rethrow so pg-boss retries
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(exportJob)
      .set({ status: 'failed', error: message })
      .where(eq(exportJob.id, jobId));
    throw err;
  }
}
