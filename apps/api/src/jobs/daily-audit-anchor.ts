import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export async function runDailyAuditAnchor(date: string): Promise<void> {
  await db.execute(sql`
    insert into audit_anchor (date, root_hash)
    select ${date}::date, hash
    from audit_log
    where ts::date = ${date}::date
    order by id desc
    limit 1
    on conflict (date) do update set root_hash = excluded.root_hash
  `);
}
