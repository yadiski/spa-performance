import type { KraCreateBatch } from '@spa/shared';
import { CycleState } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import { writeAudit } from '../../audit/log';
import type { Actor } from '../../auth/middleware';
import type { DB } from '../../db/client';
import { approvalTransition, kra, performanceCycle } from '../../db/schema';
import { validate } from '../cycle/state-machine';

type Result = { ok: true } | { ok: false; error: string };

export async function saveKraDraft(db: DB, actor: Actor, input: KraCreateBatch): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (cycle.staffId !== actor.staffId) return { ok: false, error: 'not_owner' };
    if (cycle.state !== CycleState.KraDrafting) return { ok: false, error: 'wrong_state' };

    await tx.delete(kra).where(eq(kra.cycleId, cycle.id));
    for (const k of input.kras) {
      await tx.insert(kra).values({
        cycleId: cycle.id,
        perspective: k.perspective,
        description: k.description,
        weightPct: k.weightPct,
        measurement: k.measurement,
        target: k.target,
        order: k.order,
        rubric1to5: k.rubric1to5,
      });
    }
    const total = input.kras.reduce((s, k) => s + k.weightPct, 0);
    await writeAudit(tx, {
      eventType: 'kra.drafted',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycle.id,
      payload: { count: input.kras.length, totalWeight: total },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

export async function submitKras(db: DB, actor: Actor, cycleId: string): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (cycle.staffId !== actor.staffId) return { ok: false, error: 'not_owner' };

    const kras = await tx.select().from(kra).where(eq(kra.cycleId, cycleId));
    const total = kras.reduce((s, k) => s + k.weightPct, 0);
    if (kras.length < 3 || kras.length > 5 || total !== 100) {
      return { ok: false, error: 'invalid_kra_set' };
    }

    const v = validate({
      from: cycle.state as CycleState,
      action: 'submit_kra',
      actorRoles: actor.roles,
    });
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
    });
    await writeAudit(tx, {
      eventType: 'kra.submitted',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycleId,
      payload: {},
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

async function actorIsManagerOfCycleStaff(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx type
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

export async function approveKras(db: DB, actor: Actor, cycleId: string): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };

    if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
      return { ok: false, error: 'not_manager' };
    }

    const v = validate({
      from: cycle.state as CycleState,
      action: 'approve_kra',
      actorRoles: actor.roles,
    });
    if (!v.ok) return { ok: false, error: v.reason };

    await tx
      .update(performanceCycle)
      .set({ state: v.to, kraSetAt: new Date(), updatedAt: new Date() })
      .where(eq(performanceCycle.id, cycleId));
    await tx.insert(approvalTransition).values({
      cycleId,
      fromState: cycle.state,
      toState: v.to,
      actorId: actor.userId,
    });
    await writeAudit(tx, {
      eventType: 'kra.approved',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycleId,
      payload: {},
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

export async function rejectKras(
  db: DB,
  actor: Actor,
  cycleId: string,
  note: string,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };

    if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
      return { ok: false, error: 'not_manager' };
    }

    const v = validate({
      from: cycle.state as CycleState,
      action: 'reject_kra',
      actorRoles: actor.roles,
    });
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
      note,
    });
    await writeAudit(tx, {
      eventType: 'kra.rejected',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'cycle',
      targetId: cycleId,
      payload: { note },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}
