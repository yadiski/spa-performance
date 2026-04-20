/**
 * Retention job for performance records.
 *
 * For each performance_cycle with pms_finalized_at < 7-year cutoff:
 *   1. Serialize the cycle + pms_assessment fan-out + final snapshot to .jsonl.gz
 *   2. Upload to R2 under retention-archive/performance/<cycle_id>.jsonl.gz
 *   3. Insert a retention_archive_manifest row
 *   4. Write a retention.performance.archived audit event
 *
 * NOTE: Staff rows are NOT deleted here — that is handled by the terminated-staff
 * flow in T18. This job only handles old finalized cycles.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import { cutoffFor } from '../compliance/retention';
import type { DB } from '../db/client';
import * as r2 from '../storage/r2';

export interface RetentionPerformanceResult {
  archived: number;
  skipped: number;
}

/**
 * Archive old finalized performance cycles to R2 as .jsonl.gz snapshots.
 * Keeps all rows in the database — archival is a supplementary cold-copy.
 */
export async function runRetentionPerformance(db: DB): Promise<RetentionPerformanceResult> {
  if (!r2.isConfigured()) {
    console.warn('[retention-performance] R2 not configured — skipping archive upload');
    return { archived: 0, skipped: 0 };
  }

  const cutoff = cutoffFor('performanceRecords');

  // Find all finalized cycles beyond the retention cutoff that haven't been archived yet
  const eligibleCycles = (await db.execute(sql`
    select pc.id as cycle_id
    from performance_cycle pc
    where pc.pms_finalized_at is not null
      and pc.pms_finalized_at < ${cutoff.toISOString()}::timestamptz
      and not exists (
        select 1 from retention_archive_manifest ram
        where ram.cycle_id = pc.id::text
      )
    order by pc.pms_finalized_at asc
    limit 100
  `)) as Array<{ cycle_id: string }>;

  let archived = 0;
  let skipped = 0;

  for (const { cycle_id } of eligibleCycles) {
    try {
      // Gather the full record set for this cycle
      const [cycleRows, assessmentRows, snapshotRows, kraRows] = await Promise.all([
        db.execute(sql`
          select * from performance_cycle where id = ${cycle_id}::uuid
        `),
        db.execute(sql`
          select * from pms_assessment where cycle_id = ${cycle_id}::uuid
        `),
        db.execute(sql`
          select pfs.* from pms_final_snapshot pfs
          join pms_assessment pa on pa.id = pfs.pms_id
          where pa.cycle_id = ${cycle_id}::uuid
        `),
        db.execute(sql`
          select pkr.* from pms_kra_rating pkr
          join pms_assessment pa on pa.id = pkr.pms_id
          where pa.cycle_id = ${cycle_id}::uuid
        `),
      ]);

      const records = [
        ...(Array.isArray(cycleRows) ? cycleRows : []).map((r) => ({ _type: 'cycle', ...r })),
        ...(Array.isArray(assessmentRows) ? assessmentRows : []).map((r) => ({
          _type: 'pms_assessment',
          ...r,
        })),
        ...(Array.isArray(snapshotRows) ? snapshotRows : []).map((r) => ({
          _type: 'pms_final_snapshot',
          ...r,
        })),
        ...(Array.isArray(kraRows) ? kraRows : []).map((r) => ({ _type: 'pms_kra_rating', ...r })),
      ];

      // Serialize to JSONL.GZ
      const jsonl = records.map((r) => JSON.stringify(r)).join('\n');
      const compressed = gzipSync(Buffer.from(jsonl, 'utf-8'));
      const sha256hex = createHash('sha256').update(compressed).digest('hex');

      const r2Key = `retention-archive/performance/${cycle_id}.jsonl.gz`;
      await r2.put(r2Key, compressed, 'application/gzip');

      // Record in retention_archive_manifest
      await db.execute(sql`
        insert into retention_archive_manifest (cycle_id, r2_key, sha256, row_count)
        values (${cycle_id}, ${r2Key}, ${sha256hex}, ${records.length})
        on conflict (r2_key) do nothing
      `);

      // Write audit event
      await db.transaction(async (tx) => {
        await writeAudit(tx, {
          eventType: 'retention.performance.archived',
          actorId: null,
          actorRole: 'system',
          targetType: 'performance_cycle',
          targetId: cycle_id,
          payload: { r2Key, sha256: sha256hex, rowCount: records.length },
          ip: null,
          ua: null,
        });
      });

      archived++;
    } catch (err) {
      console.error(`[retention-performance] failed to archive cycle ${cycle_id}:`, err);
      skipped++;
    }
  }

  console.log(
    `[retention-performance] archived ${archived} cycles, skipped ${skipped}, cutoff ${cutoff.toISOString()}`,
  );
  return { archived, skipped };
}
