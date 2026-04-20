import type { OpenMidYearWindow, OpenPmsWindow } from '@spa/shared';
import { NotificationKind } from '@spa/shared';
import type { CycleState } from '@spa/shared';
import { eq } from 'drizzle-orm';
import { writeAudit } from '../../audit/log';
import type { Actor } from '../../auth/middleware';
import type { DB } from '../../db/client';
import { approvalTransition, midYearCheckpoint, performanceCycle } from '../../db/schema';
import { dispatchNotifications } from '../notifications/dispatch';
import { resolveCycleActors } from '../notifications/recipients';
import { validate } from './state-machine';

type Result = { ok: true } | { ok: false; error: string };

export async function openMidYearWindow(
  db: DB,
  actor: Actor,
  input: OpenMidYearWindow,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };

    const v = validate({
      from: cycle.state as CycleState,
      action: 'open_mid_year',
      actorRoles: actor.roles,
    });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx
      .update(performanceCycle)
      .set({ state: v.to, updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycle.id));
    await tx.insert(approvalTransition).values({
      cycleId: cycle.id,
      fromState: cycle.state,
      toState: v.to,
      actorId: actor.userId,
    });
    // Create the mid_year_checkpoint row (one per cycle).
    await tx.insert(midYearCheckpoint).values({ cycleId: cycle.id }).onConflictDoNothing();
    await writeAudit(tx, {
      eventType: 'mid_year.opened',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycle.id,
      payload: {},
      ip: actor.ip,
      ua: actor.ua,
    });

    const actors = await resolveCycleActors(tx, cycle.id);
    if (actors.appraiseeStaffId) {
      await dispatchNotifications(tx, {
        kind: NotificationKind.MidYearOpened,
        payload: { cycleId: cycle.id, fromState: cycle.state, toState: v.to },
        recipients: [{ staffId: actors.appraiseeStaffId }],
        targetType: 'cycle',
        targetId: cycle.id,
      });
    }

    return { ok: true };
  });
}

export async function openPmsWindow(db: DB, actor: Actor, input: OpenPmsWindow): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };

    const v = validate({
      from: cycle.state as CycleState,
      action: 'open_pms',
      actorRoles: actor.roles,
    });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx
      .update(performanceCycle)
      .set({ state: v.to, updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycle.id));
    await tx.insert(approvalTransition).values({
      cycleId: cycle.id,
      fromState: cycle.state,
      toState: v.to,
      actorId: actor.userId,
    });
    await writeAudit(tx, {
      eventType: 'pms.opened',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycle.id,
      payload: {},
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}
