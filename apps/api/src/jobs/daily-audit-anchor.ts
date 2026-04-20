import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export async function runDailyAuditAnchor(date: string): Promise<void> {
  // Anchor the day boundary in UTC so the caller's ISO date string
  // aligns with stored ts regardless of Postgres session TZ.
  await db.execute(sql`
    insert into audit_anchor (date, root_hash)
    select ${date}::date, hash
    from audit_log
    where ts >= (${date} || ' 00:00:00+00')::timestamptz
      and ts <  (${date} || ' 00:00:00+00')::timestamptz + interval '1 day'
    order by id desc
    limit 1
    on conflict (date) do update set root_hash = excluded.root_hash
  `);
}
