import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';

export const LOCKOUT_THRESHOLD = 10;
export const LOCKOUT_WINDOW_MIN = 10;
export const LOCKOUT_DURATION_MIN = 30;

export async function recordFailedAttempt(
  db: DB,
  opts: { userId?: string; email: string; ip?: string; ua?: string },
): Promise<void> {
  await db.execute(sql`
    insert into auth_failed_attempt (user_id, email_tried, ip, ua)
    values (
      ${opts.userId ?? null}::uuid,
      ${opts.email},
      ${opts.ip ?? null}::inet,
      ${opts.ua ?? null}
    )
  `);

  if (opts.userId) {
    await checkAndMaybeLock(db, opts.userId);
  }
}

export async function isLocked(db: DB, userId: string): Promise<boolean> {
  const res = await db.execute(sql`
    select 1 from account_lockout
    where user_id = ${userId}::uuid
      and locked_until > now()
    limit 1
  `);
  const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  return rows.length > 0;
}

export async function checkAndMaybeLock(
  db: DB,
  userId: string,
): Promise<{ locked: boolean; until?: Date }> {
  // Check if already locked
  const lockRes = await db.execute(sql`
    select locked_until from account_lockout
    where user_id = ${userId}::uuid
      and locked_until > now()
    limit 1
  `);
  const lockRows = (
    Array.isArray(lockRes) ? lockRes : ((lockRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ locked_until: Date }>;

  if (lockRows.length > 0) {
    return { locked: true, until: lockRows[0]!.locked_until };
  }

  // Count recent failures
  const countRes = await db.execute(sql`
    select count(*) as cnt from auth_failed_attempt
    where user_id = ${userId}::uuid
      and occurred_at > now() - interval '${sql.raw(String(LOCKOUT_WINDOW_MIN))} minutes'
  `);
  const countRows = (
    Array.isArray(countRes) ? countRes : ((countRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ cnt: string | number }>;
  const cnt = Number(countRows[0]?.cnt ?? 0);

  if (cnt >= LOCKOUT_THRESHOLD) {
    const until = new Date(Date.now() + LOCKOUT_DURATION_MIN * 60 * 1000);
    await db.execute(sql`
      insert into account_lockout (user_id, locked_until, locked_by_system)
      values (${userId}::uuid, ${until.toISOString()}::timestamptz, true)
      on conflict (user_id) do update set
        locked_at = now(),
        locked_until = excluded.locked_until,
        locked_by_system = true,
        unlock_reason = null
    `);
    return { locked: true, until };
  }

  return { locked: false };
}

export async function unlockAccount(
  db: DB,
  opts: { userId: string; actorUserId: string; reason: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      delete from account_lockout where user_id = ${opts.userId}::uuid
    `);
    await writeAudit(tx, {
      eventType: 'auth.account.unlocked',
      actorId: opts.actorUserId,
      actorRole: null,
      targetType: 'user',
      targetId: opts.userId,
      payload: { reason: opts.reason },
      ip: null,
      ua: null,
    });
  });
}
