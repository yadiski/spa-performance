import { NotificationKind } from '@spa/shared';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';
import { dispatchNotifications } from '../domain/notifications/dispatch';
import type { Actor } from './middleware';

export const IMPERSONATION_DEFAULT_DURATION_MIN = 15;
export const IMPERSONATION_MAX_DURATION_MIN = 60;

export async function startImpersonation(
  db: DB,
  opts: {
    actor: Actor;
    targetUserId: string;
    reason: string;
    durationMin?: number;
  },
): Promise<{ sessionId: string; expiresAt: Date } | { error: string }> {
  if (!opts.actor.roles.includes('it_admin')) {
    return { error: 'forbidden — it_admin required' };
  }

  const duration = opts.durationMin ?? IMPERSONATION_DEFAULT_DURATION_MIN;
  if (duration > IMPERSONATION_MAX_DURATION_MIN) {
    return { error: `duration exceeds maximum of ${IMPERSONATION_MAX_DURATION_MIN} minutes` };
  }
  if (duration < 1) {
    return { error: 'duration must be at least 1 minute' };
  }

  const expiresAt = new Date(Date.now() + duration * 60 * 1000);

  const result = await db.transaction(async (tx) => {
    const insertRes = await tx.execute(sql`
      insert into impersonation_session (impersonator_user_id, target_user_id, reason, expires_at)
      values (
        ${opts.actor.userId}::uuid,
        ${opts.targetUserId}::uuid,
        ${opts.reason},
        ${expiresAt.toISOString()}::timestamptz
      )
      returning id
    `);
    const rows = (
      Array.isArray(insertRes) ? insertRes : ((insertRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const sessionId = rows[0]!.id;

    await writeAudit(tx, {
      eventType: 'impersonation.start',
      actorId: opts.actor.userId,
      actorRole: opts.actor.roles[0] ?? null,
      targetType: 'user',
      targetId: opts.targetUserId,
      payload: {
        sessionId,
        reason: opts.reason,
        durationMin: duration,
        expiresAt: expiresAt.toISOString(),
      },
      ip: opts.actor.ip,
      ua: opts.actor.ua,
    });

    return { sessionId, expiresAt };
  });

  // Dispatch in-app notification to target user (best-effort — requires staff record)
  try {
    const staffRes = await db.execute(sql`
      select id from staff where user_id = ${opts.targetUserId}::uuid limit 1
    `);
    const staffRows = (
      Array.isArray(staffRes) ? staffRes : ((staffRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;

    if (staffRows[0]?.id) {
      await db.transaction(async (tx) => {
        await dispatchNotifications(tx, {
          kind: NotificationKind.ImpersonationStarted,
          payload: {
            impersonatorName: opts.actor.email,
            impersonatorUserId: opts.actor.userId,
            sessionId: result.sessionId,
            expiresAt: result.expiresAt.toISOString(),
          },
          recipients: [{ staffId: staffRows[0]!.id }],
        });
      });
    }
  } catch (e) {
    console.warn('impersonation: failed to dispatch notification', e);
  }

  return result;
}

export async function endImpersonation(
  db: DB,
  opts: {
    actor: Actor;
    sessionId: string;
    reason?: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      update impersonation_session
      set ended_at = now(), ended_reason = ${opts.reason ?? 'manual'}
      where id = ${opts.sessionId}::uuid
        and impersonator_user_id = ${opts.actor.userId}::uuid
        and ended_at is null
      returning target_user_id
    `);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      target_user_id: string;
    }>;

    if (rows.length === 0) return;

    await writeAudit(tx, {
      eventType: 'impersonation.end',
      actorId: opts.actor.userId,
      actorRole: opts.actor.roles[0] ?? null,
      targetType: 'user',
      targetId: rows[0]!.target_user_id,
      payload: {
        sessionId: opts.sessionId,
        reason: opts.reason ?? 'manual',
      },
      ip: opts.actor.ip,
      ua: opts.actor.ua,
    });
  });
}

export async function getActiveImpersonation(
  db: DB,
  impersonatorUserId: string,
): Promise<{ targetUserId: string; sessionId: string; expiresAt: Date } | null> {
  const res = await db.execute(sql`
    select id, target_user_id, expires_at
    from impersonation_session
    where impersonator_user_id = ${impersonatorUserId}::uuid
      and ended_at is null
      and expires_at > now()
    order by started_at desc
    limit 1
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: string;
    target_user_id: string;
    expires_at: Date;
  }>;

  if (!rows[0]) return null;
  return {
    sessionId: rows[0].id,
    targetUserId: rows[0].target_user_id,
    expiresAt: rows[0].expires_at,
  };
}
