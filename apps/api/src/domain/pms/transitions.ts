import type { FinalizePms, PmsCycleAction } from '@spa/shared';
import { CycleState } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import { writeAudit } from '../../audit/log';
import type { Actor } from '../../auth/middleware';
import type { DB } from '../../db/client';
import {
  approvalTransition,
  cycleAmendment,
  performanceCycle,
  pmsAssessment,
  pmsFinalSnapshot,
} from '../../db/schema';
import { validate } from '../cycle/state-machine';
import { computeScore } from './scoring';

type Result = { ok: true } | { ok: false; error: string };

async function actorIsManagerOfCycleStaff(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx type varies
  tx: any,
  actor: Actor,
  cycleStaffId: string,
): Promise<boolean> {
  const res = await tx.execute(sql`select manager_id from staff where id = ${cycleStaffId}`);
  const rows = Array.isArray(res) ? res : (res.rows as unknown[]);
  const mgr = (rows as Array<{ manager_id: string | null }>)[0];
  return mgr?.manager_id === actor.staffId;
}

async function actorIsNextLevelOfCycleStaff(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx type varies
  tx: any,
  actor: Actor,
  cycleStaffId: string,
): Promise<boolean> {
  // next-level = manager of cycle staff's manager (2 levels up)
  const res = await tx.execute(sql`
    select s1.manager_id as direct_manager, s2.manager_id as next_level
    from staff s1
    left join staff s2 on s2.id = s1.manager_id
    where s1.id = ${cycleStaffId}
  `);
  const rows = Array.isArray(res) ? res : (res.rows as unknown[]);
  const row = (rows as Array<{ direct_manager: string | null; next_level: string | null }>)[0];
  return row?.next_level === actor.staffId;
}

async function runTransition(
  db: DB,
  actor: Actor,
  cycleId: string,
  action: string,
  eventType: string,
  ownershipCheck: 'self' | 'manager' | 'next_level' | 'hra' | 'none',
  payload: Record<string, unknown> = {},
  note?: string,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };

    if (ownershipCheck === 'self') {
      if (cycle.staffId !== actor.staffId) return { ok: false, error: 'not_owner' };
    } else if (ownershipCheck === 'manager') {
      if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
        return { ok: false, error: 'not_manager' };
      }
    } else if (ownershipCheck === 'next_level') {
      if (!(await actorIsNextLevelOfCycleStaff(tx, actor, cycle.staffId))) {
        return { ok: false, error: 'not_next_level' };
      }
    }
    // 'hra' and 'none' rely on role validation in the state-machine

    const v = validate({ from: cycle.state as CycleState, action, actorRoles: actor.roles });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx
      .update(performanceCycle)
      .set({ state: v.to, updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycleId));
    await tx.insert(approvalTransition).values({
      cycleId,
      fromState: cycle.state,
      toState: v.to,
      actorId: actor.userId,
      note: note ?? null,
    });
    await writeAudit(tx, {
      eventType,
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycleId,
      payload,
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

export async function submitSelfReview(
  db: DB,
  actor: Actor,
  input: PmsCycleAction,
): Promise<Result> {
  return runTransition(
    db,
    actor,
    input.cycleId,
    'submit_self_review',
    'pms.self_review.submitted',
    'self',
  );
}

export async function submitAppraiserRating(
  db: DB,
  actor: Actor,
  input: PmsCycleAction,
): Promise<Result> {
  return runTransition(
    db,
    actor,
    input.cycleId,
    'submit_appraiser_rating',
    'pms.appraiser.submitted',
    'manager',
  );
}

export async function returnToAppraisee(
  db: DB,
  actor: Actor,
  input: PmsCycleAction,
): Promise<Result> {
  return runTransition(
    db,
    actor,
    input.cycleId,
    'return_to_appraisee',
    'pms.returned_to_appraisee',
    'manager',
    {},
    input.note,
  );
}

export async function submitNextLevel(
  db: DB,
  actor: Actor,
  input: PmsCycleAction,
): Promise<Result> {
  return runTransition(
    db,
    actor,
    input.cycleId,
    'submit_next_level',
    'pms.next_level.submitted',
    'next_level',
  );
}

export async function returnToAppraiser(
  db: DB,
  actor: Actor,
  input: PmsCycleAction,
): Promise<Result> {
  return runTransition(
    db,
    actor,
    input.cycleId,
    'return_to_appraiser',
    'pms.returned_to_appraiser',
    'next_level',
    {},
    input.note,
  );
}

/**
 * HRA finalizes — computes final score, snapshots it, transitions to PmsFinalized.
 * On re-finalize (from cycle_amendment), creates a new snapshot linked to the original.
 */
export async function finalizePms(db: DB, actor: Actor, input: FinalizePms): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (!actor.roles.includes('hra')) return { ok: false, error: 'not_hra' };

    const v = validate({
      from: cycle.state as CycleState,
      action: 'finalize',
      actorRoles: actor.roles,
    });
    if (!v.ok) return { ok: false, error: v.reason };

    const [pms] = await tx.select().from(pmsAssessment).where(eq(pmsAssessment.cycleId, cycle.id));
    if (!pms) return { ok: false, error: 'pms_not_found' };

    const breakdown = await computeScore(db, cycle.id);

    // Check for open amendment — if exists, link snapshot to its original
    const [openAmend] = await tx
      .select()
      .from(cycleAmendment)
      .where(sql`original_cycle_id = ${cycle.id} and closed_at is null`);

    const [prevSnap] = openAmend?.originalSnapshotId
      ? await tx
          .select()
          .from(pmsFinalSnapshot)
          .where(eq(pmsFinalSnapshot.id, openAmend.originalSnapshotId))
      : [];

    const [snapshot] = await tx
      .insert(pmsFinalSnapshot)
      .values({
        pmsId: pms.id,
        finalizedAt: new Date(),
        finalizedBy: actor.userId,
        scoreTotal: breakdown.total.toFixed(2),
        scoreBreakdown: breakdown,
        amendmentOfSnapshotId: prevSnap?.id ?? null,
      })
      .returning();

    // Close any open amendment
    if (openAmend) {
      await tx
        .update(cycleAmendment)
        .set({ closedAt: new Date() })
        .where(eq(cycleAmendment.id, openAmend.id));
    }

    await tx
      .update(performanceCycle)
      .set({ state: v.to, pmsFinalizedAt: new Date(), updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycle.id));
    await tx.insert(approvalTransition).values({
      cycleId: cycle.id,
      fromState: cycle.state,
      toState: v.to,
      actorId: actor.userId,
    });
    await writeAudit(tx, {
      eventType: 'pms.finalized',
      actorId: actor.userId,
      actorRole: 'hra',
      targetType: 'cycle',
      targetId: cycle.id,
      payload: { snapshotId: snapshot?.id, scoreTotal: breakdown.total, amendment: !!openAmend },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

/**
 * HRA re-opens a finalized PMS — creates cycle_amendment row, reverts state.
 * This is an administrative exception: bypasses validate() because the PmsFinalized → PmsAwaitingHra
 * transition is not in the normal state machine flow. The action is documented via audit log.
 */
export async function reopenPms(
  db: DB,
  actor: Actor,
  input: { cycleId: string; reason: string },
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (!actor.roles.includes('hra')) return { ok: false, error: 'not_hra' };
    if (cycle.state !== CycleState.PmsFinalized) return { ok: false, error: 'not_finalized' };

    // Find latest snapshot
    const [pms] = await tx.select().from(pmsAssessment).where(eq(pmsAssessment.cycleId, cycle.id));
    const [latestSnap] = pms
      ? await tx
          .select()
          .from(pmsFinalSnapshot)
          .where(eq(pmsFinalSnapshot.pmsId, pms.id))
          .orderBy(sql`finalized_at desc`)
          .limit(1)
      : [];

    await tx.insert(cycleAmendment).values({
      originalCycleId: cycle.id,
      originalSnapshotId: latestSnap?.id ?? null,
      reason: input.reason,
      openedBy: actor.userId,
    });

    // Revert state to PmsAwaitingHra so HRA can modify + re-finalize
    await tx
      .update(performanceCycle)
      .set({ state: CycleState.PmsAwaitingHra, updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycle.id));
    await tx.insert(approvalTransition).values({
      cycleId: cycle.id,
      fromState: cycle.state,
      toState: CycleState.PmsAwaitingHra,
      actorId: actor.userId,
      note: input.reason,
    });
    await writeAudit(tx, {
      eventType: 'pms.reopened',
      actorId: actor.userId,
      actorRole: 'hra',
      targetType: 'cycle',
      targetId: cycle.id,
      payload: { reason: input.reason, latestSnapshotId: latestSnap?.id ?? null },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}
