import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import { cutoffFor } from '../compliance/retention';
import type { DB } from '../db/client';
import * as r2 from '../storage/r2';

export interface RetentionExportsResult {
  expired: number;
  r2Deleted: number;
}

/**
 * Marks export_job rows completed more than 1 year ago as `expired` and
 * deletes the associated R2 file. Keeps the row itself for audit trail.
 */
export async function runRetentionExports(db: DB): Promise<RetentionExportsResult> {
  const cutoff = cutoffFor('exports');

  // Find eligible rows
  const rows = (await db.execute(sql`
    select id, r2_key
    from export_job
    where status = 'completed'
      and completed_at < ${cutoff.toISOString()}::timestamptz
    order by completed_at asc
  `)) as Array<{ id: string; r2_key: string | null }>;

  let expired = 0;
  let r2Deleted = 0;

  for (const row of rows) {
    // Delete R2 object if present and R2 is configured
    if (row.r2_key && r2.isConfigured()) {
      try {
        await r2.del(row.r2_key);
        r2Deleted++;
      } catch (err) {
        console.warn(`[retention-exports] failed to delete R2 key ${row.r2_key}:`, err);
      }
    }

    // Mark row as expired (keep for audit trail)
    await db.execute(sql`
      update export_job
      set status = 'expired'
      where id = ${row.id}::uuid
    `);
    expired++;
  }

  // Write audit event
  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      eventType: 'retention.exports.expired',
      actorId: null,
      actorRole: 'system',
      targetType: 'export_job',
      targetId: null,
      payload: { expired, r2Deleted, cutoff: cutoff.toISOString() },
      ip: null,
      ua: null,
    });
  });

  console.log(
    `[retention-exports] expired ${expired} rows, deleted ${r2Deleted} R2 objects, cutoff ${cutoff.toISOString()}`,
  );
  return { expired, r2Deleted };
}
