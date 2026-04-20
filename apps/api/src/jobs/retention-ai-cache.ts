import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import { cutoffFor } from '../compliance/retention';
import type { DB } from '../db/client';

const BATCH_SIZE = 500;

export interface RetentionAiCacheResult {
  deleted: number;
}

/**
 * Deletes ai_cache rows older than 7 years in batches.
 * Defensive: this job will not fire meaningfully until ~2033. Written now for
 * operational completeness.
 */
export async function runRetentionAiCache(db: DB): Promise<RetentionAiCacheResult> {
  const cutoff = cutoffFor('aiCache');
  let totalDeleted = 0;

  while (true) {
    // Count first to avoid depending on driver-specific rowCount
    const countRes = (await db.execute(sql`
      select count(*) as cnt from ai_cache
      where created_at < ${cutoff.toISOString()}::timestamptz
    `)) as Array<{ cnt: string }>;
    const pending = Number(countRes[0]?.cnt ?? 0);
    if (pending === 0) break;

    await db.execute(sql`
      delete from ai_cache
      where id in (
        select id from ai_cache
        where created_at < ${cutoff.toISOString()}::timestamptz
        order by created_at asc
        limit ${BATCH_SIZE}
      )
    `);
    totalDeleted += Math.min(pending, BATCH_SIZE);

    if (pending <= BATCH_SIZE) break;
  }

  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      eventType: 'retention.ai_cache.deleted',
      actorId: null,
      actorRole: 'system',
      targetType: 'ai_cache',
      targetId: null,
      payload: { deleted: totalDeleted, cutoff: cutoff.toISOString() },
      ip: null,
      ua: null,
    });
  });

  console.log(
    `[retention-ai-cache] deleted ${totalDeleted} rows older than ${cutoff.toISOString()}`,
  );
  return { deleted: totalDeleted };
}
