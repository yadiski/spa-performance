import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import { cutoffFor } from '../compliance/retention';
import type { DB } from '../db/client';

const BATCH_SIZE = 1000;

export interface RetentionAuthResult {
  deleted: number;
}

/**
 * Deletes auth_failed_attempt rows older than 90 days in batches.
 * Writes a retention.auth.deleted audit event with the count.
 */
export async function runRetentionAuth(db: DB): Promise<RetentionAuthResult> {
  const cutoff = cutoffFor('authHot');
  let totalDeleted = 0;

  // Loop in batches to avoid large single-statement locks
  while (true) {
    // Use a counting select first to detect whether there is anything to delete
    const countRes = (await db.execute(sql`
      select count(*) as cnt from auth_failed_attempt
      where occurred_at < ${cutoff.toISOString()}::timestamptz
    `)) as Array<{ cnt: string }>;
    const pending = Number(countRes[0]?.cnt ?? 0);
    if (pending === 0) break;

    await db.execute(sql`
      delete from auth_failed_attempt
      where id in (
        select id from auth_failed_attempt
        where occurred_at < ${cutoff.toISOString()}::timestamptz
        order by id asc
        limit ${BATCH_SIZE}
      )
    `);
    totalDeleted += Math.min(pending, BATCH_SIZE);

    // If fewer than a full batch were eligible, we're done
    if (pending <= BATCH_SIZE) break;
  }

  // Write audit event
  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      eventType: 'retention.auth.deleted',
      actorId: null,
      actorRole: 'system',
      targetType: 'auth_failed_attempt',
      targetId: null,
      payload: { deleted: totalDeleted, cutoff: cutoff.toISOString() },
      ip: null,
      ua: null,
    });
  });

  console.log(`[retention-auth] deleted ${totalDeleted} rows older than ${cutoff.toISOString()}`);
  return { deleted: totalDeleted };
}
