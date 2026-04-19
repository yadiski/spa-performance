process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
setDefaultTimeout(30_000);
import { KraPerspective } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { Actor } from '../src/auth/middleware';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { openPmsWindow } from '../src/domain/cycle/windows';
import { computeScore } from '../src/domain/pms/scoring';
import {
  finalizePms,
  reopenPms,
  returnToAppraisee,
  returnToAppraiser,
  submitAppraiserRating,
  submitNextLevel,
  submitSelfReview,
} from '../src/domain/pms/transitions';

function mkActor(o: Partial<Actor>): Actor {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    staffId: null,
    roles: [],
    email: 'x@t',
    ip: null,
    ua: null,
    ...o,
  };
}

describe('pms transitions + scoring + re-open', () => {
  let cycleId: string;
  let hraUserId: string;
  let hraStaffId: string;
  let mgrUserId: string;
  let mgrStaffId: string;
  let nextLvlUserId: string;
  let nextLvlStaffId: string;
  let staffUserId: string;
  let staffStaffId: string;
  let kraIds: string[];

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log, pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_final_snapshot, cycle_amendment, pms_assessment, mid_year_checkpoint, approval_transition, kra_progress_update, kra, performance_cycle, staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    // Ensure behavioural_dimension seed survives the truncate
    const dimsCount = await db.select().from(s.behaviouralDimension);
    if (dimsCount.length === 0) {
      throw new Error(
        'behavioural_dimension is empty — run: bun apps/api/src/scripts/seed-behavioural-dims.ts',
      );
    }

    const [o] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [d] = await db
      .insert(s.department)
      .values({ orgId: o!.id, code: 'IT', name: 'IT' })
      .returning();
    const [g] = await db
      .insert(s.grade)
      .values({ orgId: o!.id, code: 'E10', rank: '10' })
      .returning();

    // Create users
    const [hraU] = await db.insert(s.user).values({ email: 'hra@t', name: 'HRA' }).returning();
    const [nlU] = await db.insert(s.user).values({ email: 'nl@t', name: 'NextLevel' }).returning();
    const [mgrU] = await db.insert(s.user).values({ email: 'mgr@t', name: 'MGR' }).returning();
    const [stU] = await db.insert(s.user).values({ email: 'st@t', name: 'Staff' }).returning();
    hraUserId = hraU!.id;
    nextLvlUserId = nlU!.id;
    mgrUserId = mgrU!.id;
    staffUserId = stU!.id;

    // Staff hierarchy: nextLevel -> manager -> staff
    const [hraSt] = await db
      .insert(s.staff)
      .values({
        userId: hraU!.id,
        orgId: o!.id,
        employeeNo: 'HRA1',
        name: 'HRA',
        designation: 'HR Admin',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2018-01-01',
      })
      .returning();
    hraStaffId = hraSt!.id;

    const [nlSt] = await db
      .insert(s.staff)
      .values({
        userId: nlU!.id,
        orgId: o!.id,
        employeeNo: 'NL1',
        name: 'NextLevel',
        designation: 'Director',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2019-01-01',
      })
      .returning();
    nextLvlStaffId = nlSt!.id;

    const [mgrSt] = await db
      .insert(s.staff)
      .values({
        userId: mgrU!.id,
        orgId: o!.id,
        employeeNo: 'MGR1',
        name: 'MGR',
        designation: 'Manager',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: nlSt!.id,
        hireDate: '2020-01-01',
      })
      .returning();
    mgrStaffId = mgrSt!.id;

    const [staffSt] = await db
      .insert(s.staff)
      .values({
        userId: stU!.id,
        orgId: o!.id,
        employeeNo: 'ST1',
        name: 'Staff',
        designation: 'Engineer',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: mgrSt!.id,
        hireDate: '2022-01-01',
      })
      .returning();
    staffStaffId = staffSt!.id;

    await db.insert(s.staffRole).values([
      { staffId: hraSt!.id, role: 'hra' },
      { staffId: nlSt!.id, role: 'next_level' },
      { staffId: mgrSt!.id, role: 'appraiser' },
      { staffId: staffSt!.id, role: 'staff' },
    ]);

    // Cycle starts in mid_year_done (ready for PMS open)
    const [cy] = await db
      .insert(s.performanceCycle)
      .values({
        staffId: staffStaffId,
        fy: 2026,
        state: 'mid_year_done',
      })
      .returning();
    cycleId = cy!.id;

    // KRA records (weight adds up to 100%)
    const kraIn = (order: number, weight = 50) => ({
      cycleId: cy!.id,
      perspective: KraPerspective.Financial,
      description: `KRA ${order + 1}`,
      weightPct: weight,
      measurement: 'm',
      target: 't',
      order,
      rubric1to5: ['a', 'b', 'c', 'd', 'e'],
    });
    const k1 = await db.insert(s.kra).values(kraIn(0, 50)).returning();
    const k2 = await db.insert(s.kra).values(kraIn(1, 50)).returning();
    kraIds = [k1[0]!.id, k2[0]!.id];
  });

  const hraActor = () => mkActor({ userId: hraUserId, staffId: hraStaffId, roles: ['hra'] });
  const mgrActor = () => mkActor({ userId: mgrUserId, staffId: mgrStaffId, roles: ['appraiser'] });
  const nextLvlActor = () =>
    mkActor({ userId: nextLvlUserId, staffId: nextLvlStaffId, roles: ['next_level'] });
  const staffActor = () =>
    mkActor({ userId: staffUserId, staffId: staffStaffId, roles: ['staff'] });

  async function seedPmsData() {
    // Ensure pms_assessment exists
    const [pms] = await db
      .select()
      .from(s.pmsAssessment)
      .where(eq(s.pmsAssessment.cycleId, cycleId));
    let pmsId = pms?.id;
    if (!pmsId) {
      const [newPms] = await db.insert(s.pmsAssessment).values({ cycleId }).returning();
      pmsId = newPms!.id;
    }

    // KRA ratings
    await db
      .insert(s.pmsKraRating)
      .values([
        { pmsId, kraId: kraIds[0]!, resultAchieved: 'Good', finalRating: 4 },
        { pmsId, kraId: kraIds[1]!, resultAchieved: 'Average', finalRating: 3 },
      ])
      .onConflictDoNothing();

    // Behavioural rating
    await db
      .insert(s.behaviouralRating)
      .values([
        {
          pmsId,
          dimensionCode: 'communication_skills',
          rating1to5: 4,
          rubricAnchorText: 'some anchor',
        },
      ])
      .onConflictDoNothing();

    // Staff contribution
    await db
      .insert(s.staffContribution)
      .values([{ pmsId, whenDate: 'Jan 2026', achievement: 'Mentorship', weightPct: 3 }])
      .onConflictDoNothing();

    return pmsId;
  }

  it('full happy path: open → self → appraiser → next-level → hra finalize', async () => {
    // 1. HRA opens PMS window
    const r1 = await openPmsWindow(db, hraActor(), { cycleId });
    expect(r1.ok).toBe(true);
    let cycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_self_review');

    // 2. Staff submits self-review
    const r2 = await submitSelfReview(db, staffActor(), { cycleId });
    expect(r2.ok).toBe(true);
    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_appraiser');

    // 3. Appraiser submits rating
    const r3 = await submitAppraiserRating(db, mgrActor(), { cycleId });
    expect(r3.ok).toBe(true);
    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_next_lvl');

    // 4. Next-level submits
    const r4 = await submitNextLevel(db, nextLvlActor(), { cycleId });
    expect(r4.ok).toBe(true);
    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_hra');

    // Seed PMS data for scoring
    await seedPmsData();

    // 5. HRA finalizes
    const r5 = await finalizePms(db, hraActor(), { cycleId });
    expect(r5.ok).toBe(true);
    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_finalized');
    expect(cycle[0]?.pmsFinalizedAt).not.toBeNull();

    // Verify snapshot created
    const snapshots = await db.execute(sql`select * from pms_final_snapshot`);
    const snapRows = (
      Array.isArray(snapshots) ? snapshots : ((snapshots as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string; score_total: string }>;
    expect(snapRows.length).toBe(1);
    expect(Number(snapRows[0]?.score_total)).toBeGreaterThan(0);
  });

  it('return-to-appraisee reverses self-review submission', async () => {
    // Open PMS
    await openPmsWindow(db, hraActor(), { cycleId });
    // Staff submits
    await submitSelfReview(db, staffActor(), { cycleId });
    let cycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_appraiser');

    // Manager returns to appraisee
    const r = await returnToAppraisee(db, mgrActor(), { cycleId, note: 'Please revise section 2' });
    expect(r.ok).toBe(true);
    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_self_review');

    // Verify note in approval_transition
    const transitions = await db.execute(
      sql`select note from approval_transition where cycle_id = ${cycleId} order by at desc limit 1`,
    );
    const transRows = (
      Array.isArray(transitions) ? transitions : ((transitions as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ note: string | null }>;
    expect(transRows[0]?.note).toBe('Please revise section 2');
  });

  it('return-to-appraiser reverses appraiser rating submission', async () => {
    // Get to pms_awaiting_next_lvl
    await openPmsWindow(db, hraActor(), { cycleId });
    await submitSelfReview(db, staffActor(), { cycleId });
    await submitAppraiserRating(db, mgrActor(), { cycleId });
    let cycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_next_lvl');

    // Next-level returns to appraiser
    const r = await returnToAppraiser(db, nextLvlActor(), {
      cycleId,
      note: 'KRA scoring needs review',
    });
    expect(r.ok).toBe(true);
    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_appraiser');
  });

  it('computeScore returns breakdown with total <= 5', async () => {
    // Seed cycle into pms_awaiting_appraiser so pms_assessment can exist
    await db
      .update(s.performanceCycle)
      .set({ state: 'pms_awaiting_appraiser' })
      .where(eq(s.performanceCycle.id, cycleId));

    const pmsId = await seedPmsData();

    const breakdown = await computeScore(db, cycleId);
    expect(breakdown.total).toBeLessThanOrEqual(5.0);
    expect(breakdown.total).toBeGreaterThan(0);
    expect(breakdown.kra).toBeGreaterThan(0);
    expect(breakdown.behavioural).toBeGreaterThan(0);
    expect(breakdown.contribution).toBeGreaterThan(0);

    // Verify formula:
    // KRA: (4 * 50/100 + 3 * 50/100) * 0.70 = (2 + 1.5) * 0.70 = 3.5 * 0.70 = 2.45
    // Behavioural: avg(4) * 0.25 = 1.0
    // Contribution: min(3,5) * 0.05 = 0.15
    // Total: 2.45 + 1.0 + 0.15 = 3.6
    expect(breakdown.kra).toBeCloseTo(2.45, 2);
    expect(breakdown.behavioural).toBeCloseTo(1.0, 2);
    expect(breakdown.contribution).toBeCloseTo(0.15, 2);
    expect(breakdown.total).toBeCloseTo(3.6, 2);
  });

  it('computeScore returns zeros when no pms_assessment exists', async () => {
    const breakdown = await computeScore(db, cycleId);
    expect(breakdown.kra).toBe(0);
    expect(breakdown.behavioural).toBe(0);
    expect(breakdown.contribution).toBe(0);
    expect(breakdown.total).toBe(0);
  });

  it('computeScore caps total at 5.0', async () => {
    await db
      .update(s.performanceCycle)
      .set({ state: 'pms_awaiting_appraiser' })
      .where(eq(s.performanceCycle.id, cycleId));

    const [pms] = await db.insert(s.pmsAssessment).values({ cycleId }).returning();
    const pmsId = pms!.id;

    // Max ratings: KRA 5+5 * 50/100 = 5 * 0.70 = 3.5, behavioural 5 * 0.25 = 1.25, contrib 5 * 0.05 = 0.25 → total = 5.0
    await db.insert(s.pmsKraRating).values([
      { pmsId, kraId: kraIds[0]!, resultAchieved: 'Excellent', finalRating: 5 },
      { pmsId, kraId: kraIds[1]!, resultAchieved: 'Excellent', finalRating: 5 },
    ]);
    await db
      .insert(s.behaviouralRating)
      .values([{ pmsId, dimensionCode: 'leadership', rating1to5: 5, rubricAnchorText: 'anchor' }]);
    await db
      .insert(s.staffContribution)
      .values([{ pmsId, whenDate: 'Jan 2026', achievement: 'Big project', weightPct: 5 }]);

    const breakdown = await computeScore(db, cycleId);
    expect(breakdown.total).toBeLessThanOrEqual(5.0);
    expect(breakdown.total).toBeCloseTo(5.0, 2);
  });

  it('reopenPms creates cycle_amendment and reverts state to awaiting_hra', async () => {
    // Run full cycle to finalized
    await openPmsWindow(db, hraActor(), { cycleId });
    await submitSelfReview(db, staffActor(), { cycleId });
    await submitAppraiserRating(db, mgrActor(), { cycleId });
    await submitNextLevel(db, nextLvlActor(), { cycleId });
    await seedPmsData();
    await finalizePms(db, hraActor(), { cycleId });

    // Verify finalized
    let cycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_finalized');

    // Re-open
    const r = await reopenPms(db, hraActor(), { cycleId, reason: 'Data entry error in KRA 2' });
    expect(r.ok).toBe(true);

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_hra');

    // Verify cycle_amendment created
    const amendments = await db.execute(
      sql`select * from cycle_amendment where original_cycle_id = ${cycleId}`,
    );
    const amendRows = (
      Array.isArray(amendments) ? amendments : ((amendments as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      id: string;
      reason: string;
      closed_at: string | null;
      original_snapshot_id: string | null;
    }>;
    expect(amendRows.length).toBe(1);
    expect(amendRows[0]?.reason).toBe('Data entry error in KRA 2');
    expect(amendRows[0]?.closed_at).toBeNull();
    expect(amendRows[0]?.original_snapshot_id).not.toBeNull();
  });

  it('finalize rejects non-HRA actor', async () => {
    // Get to pms_awaiting_hra
    await openPmsWindow(db, hraActor(), { cycleId });
    await submitSelfReview(db, staffActor(), { cycleId });
    await submitAppraiserRating(db, mgrActor(), { cycleId });
    await submitNextLevel(db, nextLvlActor(), { cycleId });
    await seedPmsData();

    // Try to finalize as manager (not HRA)
    const r = await finalizePms(db, mgrActor(), { cycleId });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toBe('not_hra');

    // State should not have changed
    const cycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_hra');
  });

  it('re-finalize after re-open creates 2nd snapshot linked to original', async () => {
    // Full cycle
    await openPmsWindow(db, hraActor(), { cycleId });
    await submitSelfReview(db, staffActor(), { cycleId });
    await submitAppraiserRating(db, mgrActor(), { cycleId });
    await submitNextLevel(db, nextLvlActor(), { cycleId });
    await seedPmsData();
    await finalizePms(db, hraActor(), { cycleId });

    // Get the first snapshot id
    const [pms] = await db
      .select()
      .from(s.pmsAssessment)
      .where(eq(s.pmsAssessment.cycleId, cycleId));
    const firstSnapshots = await db
      .select()
      .from(s.pmsFinalSnapshot)
      .where(eq(s.pmsFinalSnapshot.pmsId, pms!.id));
    expect(firstSnapshots.length).toBe(1);
    const firstSnapshotId = firstSnapshots[0]!.id;

    // Re-open
    await reopenPms(db, hraActor(), { cycleId, reason: 'Correction needed' });

    // Re-finalize
    const r = await finalizePms(db, hraActor(), { cycleId });
    expect(r.ok).toBe(true);

    // Should now have 2 snapshots
    const allSnapshots = await db
      .select()
      .from(s.pmsFinalSnapshot)
      .where(eq(s.pmsFinalSnapshot.pmsId, pms!.id));
    expect(allSnapshots.length).toBe(2);

    // Second snapshot should link to first
    const secondSnap = allSnapshots.find((s) => s.id !== firstSnapshotId);
    expect(secondSnap?.amendmentOfSnapshotId).toBe(firstSnapshotId);

    // Amendment should now be closed
    const amendments = await db.execute(
      sql`select closed_at from cycle_amendment where original_cycle_id = ${cycleId}`,
    );
    const amendRows = (
      Array.isArray(amendments) ? amendments : ((amendments as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ closed_at: string | null }>;
    expect(amendRows[0]?.closed_at).not.toBeNull();

    // Cycle should be finalized again
    const cycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_finalized');
  });

  it('reopenPms rejects if cycle not finalized', async () => {
    // Cycle is in mid_year_done, not finalized
    const r = await reopenPms(db, hraActor(), { cycleId, reason: 'some reason' });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toBe('not_finalized');
  });

  it('reopenPms rejects non-HRA actor', async () => {
    // Finalize first
    await openPmsWindow(db, hraActor(), { cycleId });
    await submitSelfReview(db, staffActor(), { cycleId });
    await submitAppraiserRating(db, mgrActor(), { cycleId });
    await submitNextLevel(db, nextLvlActor(), { cycleId });
    await seedPmsData();
    await finalizePms(db, hraActor(), { cycleId });

    // Try to reopen as non-HRA
    const r = await reopenPms(db, mgrActor(), { cycleId, reason: 'trying to reopen' });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toBe('not_hra');
  });

  it('submitSelfReview rejects if actor is not the cycle owner', async () => {
    await openPmsWindow(db, hraActor(), { cycleId });

    // Manager tries to submit self-review (not the staff)
    const r = await submitSelfReview(db, mgrActor(), { cycleId });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toBe('not_owner');
  });

  it('submitAppraiserRating rejects if actor is not the direct manager', async () => {
    await openPmsWindow(db, hraActor(), { cycleId });
    await submitSelfReview(db, staffActor(), { cycleId });

    // Next-level tries to submit appraiser rating (not the direct manager)
    const r = await submitAppraiserRating(db, nextLvlActor(), { cycleId });
    expect(r.ok).toBe(false);
    // State machine will reject due to role check or ownership check
    expect(r.ok).toBe(false);
  });

  it('submitNextLevel rejects if actor is not the next-level manager', async () => {
    await openPmsWindow(db, hraActor(), { cycleId });
    await submitSelfReview(db, staffActor(), { cycleId });
    await submitAppraiserRating(db, mgrActor(), { cycleId });

    // Direct manager tries to submit next-level (not the next-level manager)
    const r = await submitNextLevel(db, mgrActor(), { cycleId });
    expect(r.ok).toBe(false);
  });

  it('openPmsWindow transitions from mid_year_done to pms_self_review', async () => {
    const r = await openPmsWindow(db, hraActor(), { cycleId });
    expect(r.ok).toBe(true);
    const cycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_self_review');

    // Verify audit log entry
    const audit = await db.execute(
      sql`select event_type from audit_log where event_type = 'pms.opened' order by id desc limit 1`,
    );
    const auditRows = (
      Array.isArray(audit) ? audit : ((audit as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string }>;
    expect(auditRows[0]?.event_type).toBe('pms.opened');
  });

  it('openPmsWindow rejects non-HRA actor', async () => {
    const r = await openPmsWindow(db, mgrActor(), { cycleId });
    expect(r.ok).toBe(false);
  });

  it('finalizePms fails when no pms_assessment exists', async () => {
    // Get to pms_awaiting_hra without seeding pms data
    await openPmsWindow(db, hraActor(), { cycleId });
    await submitSelfReview(db, staffActor(), { cycleId });
    await submitAppraiserRating(db, mgrActor(), { cycleId });
    await submitNextLevel(db, nextLvlActor(), { cycleId });

    const r = await finalizePms(db, hraActor(), { cycleId });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toBe('pms_not_found');
  });
});
