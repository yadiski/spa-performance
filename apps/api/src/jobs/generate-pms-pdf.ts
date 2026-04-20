import { eq } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';
import { pmsFinalSnapshot } from '../db/schema';
import { renderPmsPdf } from '../pdf/render-pms';
import { put } from '../storage/r2';

export async function runGeneratePmsPdf(
  db: DB,
  cycleId: string,
  snapshotId: string,
  actorId: string,
): Promise<void> {
  const bytes = await renderPmsPdf(db, cycleId);

  const key = `pms/${cycleId}/${snapshotId}.pdf`;
  const { sha256 } = await put(key, bytes, 'application/pdf');

  await db
    .update(pmsFinalSnapshot)
    .set({ pdfR2Key: key, pdfSha256: sha256 })
    .where(eq(pmsFinalSnapshot.id, snapshotId));

  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      eventType: 'pms.pdf.generated',
      actorId,
      actorRole: 'hra',
      targetType: 'cycle',
      targetId: cycleId,
      payload: { snapshotId, key, sha256 },
      ip: null,
      ua: null,
    });
  });
}
