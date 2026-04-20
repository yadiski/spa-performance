import { sql } from 'drizzle-orm';
import { cutoffFor } from '../compliance/retention';
import { anonymizeTerminatedStaff } from '../compliance/termination';
import type { DB } from '../db/client';

export interface RetentionTerminatedStaffResult {
  anonymized: number;
  failed: number;
}

/**
 * Finds staff members whose terminated_at is older than 7 years and
 * anonymises their profile data in compliance with the retention policy.
 */
export async function runRetentionTerminatedStaff(db: DB): Promise<RetentionTerminatedStaffResult> {
  const cutoff = cutoffFor('staffActive');

  // Find terminated staff beyond the 7-year window who haven't been anonymised yet
  // (name = '' is our sentinel for already-anonymised rows)
  const eligible = (await db.execute(sql`
    select id
    from staff
    where terminated_at is not null
      and terminated_at < ${cutoff.toISOString()}::timestamptz
      and name != ''
    order by terminated_at asc
    limit 100
  `)) as Array<{ id: string }>;

  let anonymized = 0;
  let failed = 0;

  for (const { id } of eligible) {
    try {
      await anonymizeTerminatedStaff(db, { staffId: id });
      anonymized++;
    } catch (err) {
      console.error(`[retention-terminated-staff] failed to anonymize staff ${id}:`, err);
      failed++;
    }
  }

  console.log(
    `[retention-terminated-staff] anonymized ${anonymized} staff, failed ${failed}, cutoff ${cutoff.toISOString()}`,
  );
  return { anonymized, failed };
}
