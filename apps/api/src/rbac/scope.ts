import { type SQL, sql } from 'drizzle-orm';
import type { Actor } from '../auth/middleware';
import type { DB } from '../db/client';
import { transitiveReports } from './hierarchy';

export type ScopePredicate = SQL;

/**
 * Returns a SQL predicate that limits `staff.id` to rows the actor may read.
 * Compose with other WHERE clauses.
 */
export async function staffReadScope(db: DB, actor: Actor): Promise<ScopePredicate> {
  if (actor.roles.includes('hra') || actor.roles.includes('hr_manager')) return sql`true`;

  const ids = new Set<string>();
  if (actor.staffId) ids.add(actor.staffId);

  if (actor.roles.includes('appraiser') && actor.staffId) {
    const reports = await transitiveReports(db, actor.staffId, 1);
    for (const r of reports) ids.add(r.id);
  }
  if (actor.roles.includes('next_level') && actor.staffId) {
    const reports = await transitiveReports(db, actor.staffId, 2);
    for (const r of reports) ids.add(r.id);
  }
  if (actor.roles.includes('department_head') && actor.staffId) {
    return sql`staff.department_id = (select department_id from staff where id = ${actor.staffId})`;
  }

  if (ids.size === 0) return sql`false`;
  const list = sql.join(
    Array.from(ids).map((id) => sql`${id}::uuid`),
    sql`,`,
  );
  return sql`staff.id in (${list})`;
}
