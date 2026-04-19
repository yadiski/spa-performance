import type { MidYearAck, MidYearSave, MidYearSubmit } from '@spa/shared';
import { CycleState } from '@spa/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { writeAudit } from '../../audit/log';
import type { Actor } from '../../auth/middleware';
import type { DB } from '../../db/client';
import {
  approvalTransition,
  kra,
  kraProgressUpdate,
  midYearCheckpoint,
  performanceCycle,
} from '../../db/schema';
import { validate } from '../cycle/state-machine';

type Result = { ok: true } | { ok: false; error: string };

async function actorIsManagerOfCycleStaff(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx type varies
  tx: any,
  actor: Actor,
  cycleStaffId: string,
): Promise<boolean> {
  const res = await tx.execute(sql`
    select manager_id from staff where id = ${cycleStaffId}
  `);
  const rows = Array.isArray(res) ? res : (res.rows as unknown[]);
  const mgr = (rows as Array<{ manager_id: string | null }>)[0];
  return mgr?.manager_id === actor.staffId;
}

/**
 * Staff saves per-KRA mid-year result + informal rating into kra_progress_update
 * plus an optional summary on the checkpoint. Cycle must be in MidYearOpen.
 * This is a draft save — no state transition.
 */
export async function saveMidYearUpdate(db: DB, actor: Actor, input: MidYearSave): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (cycle.staffId !== actor.staffId) return { ok: false, error: 'not_owner' };
    if (cycle.state !== CycleState.MidYearOpen) return { ok: false, error: 'wrong_state' };

    // Confirm every incoming kraId belongs to this cycle to prevent cross-cycle writes.
    const kraIds = input.updates.map((u) => u.kraId);
    const kras = await tx
      .select()
      .from(kra)
      .where(and(eq(kra.cycleId, cycle.id), inArray(kra.id, kraIds)));
    if (kras.length !== kraIds.length) {
      return { ok: false, error: 'kra_not_in_cycle' };
    }

    // Replace prior mid-year progress updates for these KRAs (draft-replace semantics).
    for (const u of input.updates) {
      await tx
        .delete(kraProgressUpdate)
        .where(and(eq(kraProgressUpdate.kraId, u.kraId), eq(kraProgressUpdate.byRole, 'mid_year')));
      await tx.insert(kraProgressUpdate).values({
        kraId: u.kraId,
        byRole: 'mid_year',
        resultAchieved: u.resultAchieved,
        rating1to5: u.informalRating,
      });
    }

    if (input.summary !== undefined) {
      await tx
        .update(midYearCheckpoint)
        .set({ summary: input.summary, updatedAt: new Date() })
        .where(eq(midYearCheckpoint.cycleId, cycle.id));
    }

    await writeAudit(tx, {
      eventType: 'mid_year.saved',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycle.id,
      payload: { updateCount: input.updates.length },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

/**
 * Staff submits — triggers MidYearOpen → MidYearSubmitted.
 * Validates at least one mid-year progress update exists.
 */
export async function submitMidYearUpdate(
  db: DB,
  actor: Actor,
  input: MidYearSubmit,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (cycle.staffId !== actor.staffId) return { ok: false, error: 'not_owner' };

    // Confirm at least one update exists for this cycle.
    const countRes = await tx.execute(sql`
      select count(*)::int as n from kra_progress_update u
      join kra k on k.id = u.kra_id
      where k.cycle_id = ${cycle.id} and u.by_role = 'mid_year'
    `);
    const countRows = (
      Array.isArray(countRes) ? countRes : ((countRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ n: number }>;
    if ((countRows[0]?.n ?? 0) < 1) return { ok: false, error: 'no_updates' };

    const v = validate({
      from: cycle.state as CycleState,
      action: 'submit_mid_year',
      actorRoles: actor.roles,
    });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx
      .update(performanceCycle)
      .set({ state: v.to, midYearAt: new Date(), updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycle.id));
    await tx
      .update(midYearCheckpoint)
      .set({ submittedAt: new Date(), submittedBy: actor.userId, updatedAt: new Date() })
      .where(eq(midYearCheckpoint.cycleId, cycle.id));
    await tx.insert(approvalTransition).values({
      cycleId: cycle.id,
      fromState: cycle.state,
      toState: v.to,
      actorId: actor.userId,
    });
    await writeAudit(tx, {
      eventType: 'mid_year.submitted',
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

/**
 * Appraiser acknowledges mid-year — triggers MidYearSubmitted → MidYearDone.
 */
export async function ackMidYear(db: DB, actor: Actor, input: MidYearAck): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };

    if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
      return { ok: false, error: 'not_manager' };
    }

    const v = validate({
      from: cycle.state as CycleState,
      action: 'ack_mid_year',
      actorRoles: actor.roles,
    });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx
      .update(performanceCycle)
      .set({ state: v.to, updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycle.id));
    await tx
      .update(midYearCheckpoint)
      .set({ ackedAt: new Date(), ackedBy: actor.userId, updatedAt: new Date() })
      .where(eq(midYearCheckpoint.cycleId, cycle.id));
    await tx.insert(approvalTransition).values({
      cycleId: cycle.id,
      fromState: cycle.state,
      toState: v.to,
      actorId: actor.userId,
      note: input.note ?? null,
    });
    await writeAudit(tx, {
      eventType: 'mid_year.acked',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycle.id,
      payload: { note: input.note ?? null },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}
