import { writeAudit } from '../audit/log';
import type { Actor } from '../auth/middleware';
import type { DB } from '../db/client';

export interface ScopeViolationOpts {
  actor: Actor;
  targetType: string;
  targetId?: string | null;
  reason: string;
}

/**
 * Writes a security.scope_violation audit event.
 * Call this before returning a 403 on a high-value access check.
 * Fire-and-forget via db.transaction; if audit write fails, the 403 still goes through.
 */
export async function auditScopeViolation(db: DB, opts: ScopeViolationOpts): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'security.scope_violation',
        actorId: opts.actor.userId,
        actorRole: opts.actor.roles[0] ?? null,
        targetType: opts.targetType,
        targetId: opts.targetId ?? null,
        payload: {
          reason: opts.reason,
          actorRoles: opts.actor.roles,
          actorStaffId: opts.actor.staffId,
        },
        ip: opts.actor.ip,
        ua: opts.actor.ua,
      });
    });
  } catch (e) {
    console.warn('auditScopeViolation: failed to write audit event', e);
  }
}
