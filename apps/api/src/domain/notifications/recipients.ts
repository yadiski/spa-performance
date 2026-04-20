import { sql } from 'drizzle-orm';
import type { DB } from '../../db/client';

type TxLike = Parameters<Parameters<DB['transaction']>[0]>[0];

export interface CycleActors {
  appraiseeStaffId: string | null;
  appraiserStaffId: string | null;
  nextLevelStaffId: string | null;
  hraStaffIds: string[];
}

export async function resolveCycleActors(tx: TxLike, cycleId: string): Promise<CycleActors> {
  // Query 1: resolve appraisee → appraiser → next-level chain
  const chainRes = await tx.execute(sql`
    select
      s_appraisee.id            as appraisee_id,
      s_appraisee.org_id        as org_id,
      s_appraisee.manager_id    as appraiser_id,
      s_appraiser.manager_id    as next_level_id
    from performance_cycle pc
    join staff s_appraisee on s_appraisee.id = pc.staff_id
    left join staff s_appraiser on s_appraiser.id = s_appraisee.manager_id
    where pc.id = ${cycleId}
    limit 1
  `);
  const chainRows = (
    Array.isArray(chainRes) ? chainRes : ((chainRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{
    appraisee_id: string | null;
    org_id: string | null;
    appraiser_id: string | null;
    next_level_id: string | null;
  }>;

  const chain = chainRows[0];
  if (!chain) {
    return {
      appraiseeStaffId: null,
      appraiserStaffId: null,
      nextLevelStaffId: null,
      hraStaffIds: [],
    };
  }

  // Query 2: all HRAs in the appraisee's org
  const hraRes = chain.org_id
    ? await tx.execute(sql`
        select sr.staff_id
        from staff_role sr
        join staff s on s.id = sr.staff_id
        where sr.role = 'hra'
          and s.org_id = ${chain.org_id}
      `)
    : [];
  const hraRows = (
    Array.isArray(hraRes) ? hraRes : ((hraRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ staff_id: string }>;

  return {
    appraiseeStaffId: chain.appraisee_id,
    appraiserStaffId: chain.appraiser_id,
    nextLevelStaffId: chain.next_level_id,
    hraStaffIds: hraRows.map((r) => r.staff_id),
  };
}
