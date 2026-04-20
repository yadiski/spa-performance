import type { DB } from '../db/client';
import { boss } from '../jobs/queue';

const REFRESH_QUEUE = 'dashboards.refresh';

/**
 * Refresh all dashboard materialized views in dependency order.
 * mv_cycle_summary must be refreshed before the two rollup views
 * since they aggregate from it.
 */
export async function refreshDashboardViews(db: DB): Promise<void> {
  // Refresh cycle summary first (the other views depend on it)
  await db.execute(
    // biome-ignore lint/suspicious/noExplicitAny: raw SQL helper
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cycle_summary' as unknown as any,
  );
  // Then refresh the two rollup views (can run in any order relative to each other)
  await db.execute(
    // biome-ignore lint/suspicious/noExplicitAny: raw SQL helper
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dept_rollup' as unknown as any,
  );
  await db.execute(
    // biome-ignore lint/suspicious/noExplicitAny: raw SQL helper
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_org_rollup' as unknown as any,
  );
}

/**
 * Enqueue an on-demand dashboard refresh job (non-blocking).
 * Safe to call after finalize or bulk window operations.
 */
export async function enqueueRefresh(): Promise<void> {
  await boss.send(REFRESH_QUEUE, {});
}

export { REFRESH_QUEUE };
