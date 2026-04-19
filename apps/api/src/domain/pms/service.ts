import type {
  SaveBehaviouralRatings,
  SaveCareerDevelopment,
  SavePersonalGrowth,
  SavePmsComment,
  SavePmsKraRatings,
  SaveStaffContributions,
} from '@spa/shared';
import { CycleState, PmsCommentRole } from '@spa/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { writeAudit } from '../../audit/log';
import type { Actor } from '../../auth/middleware';
import type { DB } from '../../db/client';
import {
  behaviouralDimension,
  behaviouralRating,
  careerDevelopment,
  kra,
  performanceCycle,
  personalGrowth,
  pmsAssessment,
  pmsComment,
  pmsKraRating,
  staffContribution,
} from '../../db/schema';

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

async function ensurePmsAssessment(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx type varies
  tx: any,
  cycleId: string,
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(pmsAssessment)
    .where(eq(pmsAssessment.cycleId, cycleId));
  if (existing) return existing.id;
  const [created] = await tx.insert(pmsAssessment).values({ cycleId }).returning();
  return created.id;
}

/**
 * Part I — appraiser rates each KRA 1-5 with result + comment.
 */
export async function savePmsKraRatings(
  db: DB,
  actor: Actor,
  input: SavePmsKraRatings,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
      return { ok: false, error: 'not_manager' };
    }
    if (cycle.state !== CycleState.PmsAwaitingAppraiser) {
      return { ok: false, error: 'wrong_state' };
    }

    // Verify every kraId belongs to this cycle
    const kraIds = input.ratings.map((r) => r.kraId);
    const kras = await tx
      .select()
      .from(kra)
      .where(and(eq(kra.cycleId, cycle.id), inArray(kra.id, kraIds)));
    if (kras.length !== kraIds.length) return { ok: false, error: 'kra_not_in_cycle' };

    const pmsId = await ensurePmsAssessment(tx, cycle.id);

    // Replace prior ratings in this PMS for affected KRAs
    await tx
      .delete(pmsKraRating)
      .where(and(eq(pmsKraRating.pmsId, pmsId), inArray(pmsKraRating.kraId, kraIds)));
    for (const r of input.ratings) {
      await tx.insert(pmsKraRating).values({
        pmsId,
        kraId: r.kraId,
        resultAchieved: r.resultAchieved,
        finalRating: r.finalRating,
        comment: r.comment ?? null,
      });
    }
    await writeAudit(tx, {
      eventType: 'pms.kra_ratings.saved',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'pms',
      targetId: pmsId,
      payload: { count: input.ratings.length },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

/**
 * Part II — appraiser rates all 22 behavioural dimensions.
 * Validates that rubricAnchorText matches the dimension's anchor at rating-1 index.
 */
export async function saveBehaviouralRatings(
  db: DB,
  actor: Actor,
  input: SaveBehaviouralRatings,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
      return { ok: false, error: 'not_manager' };
    }
    if (cycle.state !== CycleState.PmsAwaitingAppraiser) {
      return { ok: false, error: 'wrong_state' };
    }

    // Validate each rating's anchor text against the dimension's seeded anchor at rating-1.
    const codes = input.ratings.map((r) => r.dimensionCode);
    const dims = await tx
      .select()
      .from(behaviouralDimension)
      .where(inArray(behaviouralDimension.code, codes));
    const byCode = new Map(dims.map((d) => [d.code, d]));
    for (const r of input.ratings) {
      const dim = byCode.get(r.dimensionCode);
      if (!dim) return { ok: false, error: `unknown_dimension:${r.dimensionCode}` };
      const anchors = dim.anchors as string[];
      const expected = anchors[r.rating1to5 - 1];
      if (expected !== r.rubricAnchorText) {
        return { ok: false, error: `anchor_mismatch:${r.dimensionCode}` };
      }
    }

    const pmsId = await ensurePmsAssessment(tx, cycle.id);
    await tx.delete(behaviouralRating).where(eq(behaviouralRating.pmsId, pmsId));
    for (const r of input.ratings) {
      await tx.insert(behaviouralRating).values({
        pmsId,
        dimensionCode: r.dimensionCode,
        rating1to5: r.rating1to5,
        rubricAnchorText: r.rubricAnchorText,
        comment: r.comment ?? null,
      });
    }
    await writeAudit(tx, {
      eventType: 'pms.behavioural.saved',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'pms',
      targetId: pmsId,
      payload: { count: input.ratings.length },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

/**
 * Part III — staff contribution (bonus up to 5% total).
 */
export async function saveStaffContributions(
  db: DB,
  actor: Actor,
  input: SaveStaffContributions,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
      return { ok: false, error: 'not_manager' };
    }
    if (cycle.state !== CycleState.PmsAwaitingAppraiser) {
      return { ok: false, error: 'wrong_state' };
    }

    const pmsId = await ensurePmsAssessment(tx, cycle.id);
    await tx.delete(staffContribution).where(eq(staffContribution.pmsId, pmsId));
    for (const c of input.contributions) {
      await tx.insert(staffContribution).values({
        pmsId,
        whenDate: c.whenDate,
        achievement: c.achievement,
        weightPct: c.weightPct,
      });
    }
    await writeAudit(tx, {
      eventType: 'pms.contribution.saved',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'pms',
      targetId: pmsId,
      payload: { count: input.contributions.length },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

/**
 * Part V(a) — career development (upsert, one-per-pms).
 */
export async function saveCareerDevelopment(
  db: DB,
  actor: Actor,
  input: SaveCareerDevelopment,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
      return { ok: false, error: 'not_manager' };
    }
    if (cycle.state !== CycleState.PmsAwaitingAppraiser) {
      return { ok: false, error: 'wrong_state' };
    }

    const pmsId = await ensurePmsAssessment(tx, cycle.id);
    await tx
      .insert(careerDevelopment)
      .values({
        pmsId,
        potentialWindow: input.potentialWindow,
        readyIn: input.readyIn ?? null,
        comments: input.comments ?? null,
      })
      .onConflictDoUpdate({
        target: careerDevelopment.pmsId,
        set: {
          potentialWindow: input.potentialWindow,
          readyIn: input.readyIn ?? null,
          comments: input.comments ?? null,
          updatedAt: new Date(),
        },
      });
    await writeAudit(tx, {
      eventType: 'pms.career.saved',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'pms',
      targetId: pmsId,
      payload: { potentialWindow: input.potentialWindow },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

/**
 * Part V(b) — personal growth (upsert).
 */
export async function savePersonalGrowth(
  db: DB,
  actor: Actor,
  input: SavePersonalGrowth,
): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };
    if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
      return { ok: false, error: 'not_manager' };
    }
    if (cycle.state !== CycleState.PmsAwaitingAppraiser) {
      return { ok: false, error: 'wrong_state' };
    }

    const pmsId = await ensurePmsAssessment(tx, cycle.id);
    await tx
      .insert(personalGrowth)
      .values({
        pmsId,
        trainingNeeds: input.trainingNeeds ?? null,
        comments: input.comments ?? null,
      })
      .onConflictDoUpdate({
        target: personalGrowth.pmsId,
        set: {
          trainingNeeds: input.trainingNeeds ?? null,
          comments: input.comments ?? null,
          updatedAt: new Date(),
        },
      });
    await writeAudit(tx, {
      eventType: 'pms.growth.saved',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'pms',
      targetId: pmsId,
      payload: {},
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}

/**
 * Part VI — save/update an unsigned comment body. Signing is separate (T24).
 * Allowed state depends on role:
 *  - appraiser:   pms_awaiting_appraiser
 *  - appraisee:   pms_self_review OR pms_awaiting_appraiser (for reaction to return)
 *  - next_level:  pms_awaiting_next_lvl
 */
export async function savePmsComment(db: DB, actor: Actor, input: SavePmsComment): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.id, input.cycleId));
    if (!cycle) return { ok: false, error: 'cycle_not_found' };

    // Role-specific state + ownership checks
    if (input.role === PmsCommentRole.Appraisee) {
      if (cycle.staffId !== actor.staffId) return { ok: false, error: 'not_owner' };
      if (
        cycle.state !== CycleState.PmsSelfReview &&
        cycle.state !== CycleState.PmsAwaitingAppraiser
      ) {
        return { ok: false, error: 'wrong_state' };
      }
    } else if (input.role === PmsCommentRole.Appraiser) {
      if (!(await actorIsManagerOfCycleStaff(tx, actor, cycle.staffId))) {
        return { ok: false, error: 'not_manager' };
      }
      if (cycle.state !== CycleState.PmsAwaitingAppraiser) {
        return { ok: false, error: 'wrong_state' };
      }
    } else {
      // next_level — only in PmsAwaitingNextLevel; caller must have next_level role
      if (!actor.roles.includes('next_level')) return { ok: false, error: 'not_next_level' };
      if (cycle.state !== CycleState.PmsAwaitingNextLevel) {
        return { ok: false, error: 'wrong_state' };
      }
    }

    const pmsId = await ensurePmsAssessment(tx, cycle.id);

    // One unsigned comment per (pms, role) — replace existing unsigned.
    await tx
      .delete(pmsComment)
      .where(
        and(eq(pmsComment.pmsId, pmsId), eq(pmsComment.role, input.role), sql`signed_at is null`),
      );
    await tx.insert(pmsComment).values({
      pmsId,
      role: input.role,
      body: input.body,
    });
    await writeAudit(tx, {
      eventType: 'pms.comment.saved',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'pms',
      targetId: pmsId,
      payload: { role: input.role },
      ip: actor.ip,
      ua: actor.ua,
    });
    return { ok: true };
  });
}
