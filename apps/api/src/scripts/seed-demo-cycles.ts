#!/usr/bin/env bun
/**
 * Demo-data seeder: drives a slice of the seeded staff through the full
 * cycle state machine using the real services so every dashboard, trajectory,
 * and report has realistic data.
 *
 * Distribution for FY 2026 (from the 33 eligible staff — CEO + VPs
 * excluded because they lack a full appraiser + next-level chain).
 * EVERY eligible staff reaches mid_year_done at minimum so the mid-year
 * report is fully populated:
 *   - 5 finalized                → dashboards + exports populated
 *   - 5 pms_awaiting_hra         → HRA finalize queue
 *   - 5 pms_awaiting_next_lvl    → next-level pending
 *   - 5 pms_awaiting_appraiser   → self-review submitted
 *   - 5 pms_self_review          → PMS window open, waiting on staff
 *   - 8 mid_year_done            → full mid-year done, ready for PMS
 *
 * Run from repo root (so .env.local is picked up):
 *   bun apps/api/src/scripts/seed-demo-cycles.ts
 *
 * Optional env:
 *   DEMO_FY=2026                 (default: 2026)
 *   DEMO_DRY_RUN=true            (no DB writes; just prints the plan)
 */

import { CycleState, KraPerspective, PmsCommentRole, PotentialWindow } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import type { Actor } from '../auth/middleware';
import { db } from '../db/client';
import {
  behaviouralDimension,
  kra,
  performanceCycle,
  pmsKraRating,
  staff,
  staffRole,
  user,
} from '../db/schema';
import { openMidYearWindow, openPmsWindow } from '../domain/cycle/windows';
import { approveKras, saveKraDraft, submitKras } from '../domain/kra/service';
import { ackMidYear, saveMidYearUpdate, submitMidYearUpdate } from '../domain/mid-year/service';
import {
  saveBehaviouralRatings,
  saveCareerDevelopment,
  savePersonalGrowth,
  savePmsComment,
  savePmsKraRatings,
  saveStaffContributions,
} from '../domain/pms/service';
import {
  returnToAppraisee as _rta,
  finalizePms,
  submitAppraiserRating,
  submitNextLevel,
  submitSelfReview,
} from '../domain/pms/transitions';
import { boss, startBoss } from '../jobs/queue';

console.log('[seed-cycles] boot');
const DEMO_FY = Number(process.env.DEMO_FY ?? '2026');
const DRY_RUN = process.env.DEMO_DRY_RUN === 'true';
console.log('[seed-cycles] env parsed');

interface StaffRow {
  staffId: string;
  userId: string;
  name: string;
  email: string;
  managerId: string | null;
  orgId: string;
  roles: string[];
}

async function loadStaff(): Promise<StaffRow[]> {
  const rows = await db.execute(sql`
    select s.id as staff_id, s.user_id, s.name, u.email, s.manager_id, s.org_id,
           coalesce(array_agg(sr.role) filter (where sr.role is not null), '{}') as roles
    from staff s
    join "user" u on u.id = s.user_id
    left join staff_role sr on sr.staff_id = s.id
    where s.terminated_at is null
    group by s.id, s.user_id, s.name, u.email, s.manager_id, s.org_id
    order by s.employee_no
  `);
  const items = (
    Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])
  ) as Array<{
    staff_id: string;
    user_id: string;
    name: string;
    email: string;
    manager_id: string | null;
    org_id: string;
    roles: string[];
  }>;
  return items.map((r) => ({
    staffId: r.staff_id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    managerId: r.manager_id,
    orgId: r.org_id,
    roles: r.roles,
  }));
}

function actorFor(s: StaffRow, extraRoles: string[] = []): Actor {
  // Always include 'staff' — every real employee is first and foremost a
  // staff member, even if their primary role is appraiser / next_level.
  const roles = new Set<string>([...s.roles, ...extraRoles, 'staff']);
  return {
    userId: s.userId,
    staffId: s.staffId,
    // biome-ignore lint/suspicious/noExplicitAny: role enum widened to string array for script use
    roles: Array.from(roles) as any,
    email: s.email,
    ip: null,
    ua: 'seed-demo-cycles',
  };
}

/** Build an HRA actor using the existing org HRA (CEO) so HR-only services
 *  authorize correctly regardless of which staff we're acting on. */
function hraActor(hra: StaffRow): Actor {
  const roles = new Set([...hra.roles, 'hra', 'hr_manager']);
  return {
    userId: hra.userId,
    staffId: hra.staffId,
    // biome-ignore lint/suspicious/noExplicitAny: dynamic roles
    roles: Array.from(roles) as any,
    email: hra.email,
    ip: null,
    ua: 'seed-demo-cycles',
  };
}

// ── Seed content generators ─────────────────────────────────────────────────

const PERSPECTIVES = Object.values(KraPerspective);
const KRA_SEEDS = [
  {
    description: 'Deliver quarterly operational KPIs aligned with organisation targets.',
    measurement: 'Quarterly dashboard review',
    target: 'Meet or exceed 90% of targets',
    rubric: [
      'Falls below target by >30%',
      'Falls below target by 10-30%',
      'Within ±10% of target',
      'Exceeds target by up to 20%',
      'Exceeds target by >20%',
    ],
  },
  {
    description: 'Drive process improvements that reduce cycle time or cost.',
    measurement: 'Documented improvements delivered',
    target: 'Ship at least 3 measurable improvements',
    rubric: [
      'No improvements delivered',
      '1 improvement with limited impact',
      '2 improvements with measurable impact',
      '3 impactful improvements with stakeholder recognition',
      '4+ transformative improvements',
    ],
  },
  {
    description: 'Strengthen cross-functional collaboration with adjacent teams.',
    measurement: 'Stakeholder feedback + completed joint initiatives',
    target: 'Positive feedback from ≥3 stakeholders',
    rubric: [
      'No joint work attempted',
      'Limited engagement, weak outcomes',
      'Meets baseline — 2 joint initiatives',
      'Strong partnerships across 3 teams',
      'Exemplary leadership across the function',
    ],
  },
];

function makeKraValues(): Array<{
  perspective: KraPerspective;
  description: string;
  weightPct: number;
  measurement: string;
  target: string;
  order: number;
  rubric1to5: [string, string, string, string, string];
}> {
  return KRA_SEEDS.map((k, i) => ({
    perspective: PERSPECTIVES[i % PERSPECTIVES.length] as KraPerspective,
    description: k.description,
    weightPct: i === 0 ? 40 : 30,
    measurement: k.measurement,
    target: k.target,
    order: i,
    rubric1to5: k.rubric as [string, string, string, string, string],
  }));
}

const CONTRIBUTIONS = [
  {
    whenDate: `${DEMO_FY}-03-15`,
    achievement: 'Led the rollout of the revised SOP that cut turnaround by 18%.',
    weightPct: 40,
  },
  {
    whenDate: `${DEMO_FY}-07-10`,
    achievement: 'Mentored two juniors through their first customer-facing sprints.',
    weightPct: 30,
  },
  {
    whenDate: `${DEMO_FY}-10-04`,
    achievement: 'Presented quarterly KPIs to the VP panel with clear talking points.',
    weightPct: 30,
  },
];

// ── State drivers ───────────────────────────────────────────────────────────

async function driveToKraApproved(
  hra: StaffRow,
  appraisee: StaffRow,
  appraiser: StaffRow | null,
  cycleId: string,
): Promise<void> {
  // Save draft as the appraisee
  const draft = await saveKraDraft(db, actorFor(appraisee), {
    cycleId,
    kras: makeKraValues(),
  });
  if (!draft.ok) throw new Error(`draft: ${draft.error}`);

  // Submit as the appraisee
  const submit = await submitKras(db, actorFor(appraisee), cycleId);
  if (!submit.ok) throw new Error(`submit: ${submit.error}`);

  // Approve as the appraiser (or HRA if no direct manager)
  const approver = appraiser ? actorFor(appraiser, ['appraiser']) : hraActor(hra);
  const approve = await approveKras(db, approver, cycleId);
  if (!approve.ok) throw new Error(`approve: ${approve.error}`);
}

async function driveToMidYearDone(
  hra: StaffRow,
  appraisee: StaffRow,
  appraiser: StaffRow | null,
  cycleId: string,
): Promise<void> {
  await driveToKraApproved(hra, appraisee, appraiser, cycleId);

  // HRA opens mid-year
  const open = await openMidYearWindow(db, hraActor(hra), { cycleId });
  if (!open.ok) throw new Error(`open mid-year: ${open.error}`);

  // Staff saves + submits mid-year update (for each of their KRAs)
  const kras = await db.select().from(kra).where(eq(kra.cycleId, cycleId));
  const updates = kras.map((k) => ({
    kraId: k.id,
    resultAchieved:
      'Halfway delivered — on track with minor ramp needed in Q3 on dependent workstreams.',
    informalRating: 3,
  }));
  const save = await saveMidYearUpdate(db, actorFor(appraisee), { cycleId, updates });
  if (!save.ok) throw new Error(`mid-year save: ${save.error}`);
  const submit = await submitMidYearUpdate(db, actorFor(appraisee), { cycleId });
  if (!submit.ok) throw new Error(`mid-year submit: ${submit.error}`);

  // Appraiser acks (if there's a direct manager, else HRA serves)
  const ackActor = appraiser ? actorFor(appraiser, ['appraiser']) : hraActor(hra);
  const ack = await ackMidYear(db, ackActor, { cycleId });
  if (!ack.ok) throw new Error(`mid-year ack: ${ack.error}`);
}

async function driveToMidYearSubmitted(
  hra: StaffRow,
  appraisee: StaffRow,
  appraiser: StaffRow | null,
  cycleId: string,
): Promise<void> {
  await driveToKraApproved(hra, appraisee, appraiser, cycleId);
  const open = await openMidYearWindow(db, hraActor(hra), { cycleId });
  if (!open.ok) throw new Error(`open mid-year: ${open.error}`);

  const kras = await db.select().from(kra).where(eq(kra.cycleId, cycleId));
  const updates = kras.map((k) => ({
    kraId: k.id,
    resultAchieved: 'In progress — on plan for the main targets so far.',
    informalRating: 3,
  }));
  const save = await saveMidYearUpdate(db, actorFor(appraisee), { cycleId, updates });
  if (!save.ok) throw new Error(`mid-year save: ${save.error}`);
  const submit = await submitMidYearUpdate(db, actorFor(appraisee), { cycleId });
  if (!submit.ok) throw new Error(`mid-year submit: ${submit.error}`);
}

async function driveToPmsAwaitingAppraiser(
  hra: StaffRow,
  appraisee: StaffRow,
  appraiser: StaffRow | null,
  cycleId: string,
): Promise<void> {
  await driveToMidYearDone(hra, appraisee, appraiser, cycleId);
  const open = await openPmsWindow(db, hraActor(hra), { cycleId });
  if (!open.ok) throw new Error(`open pms: ${open.error}`);

  // Staff writes self-review comment + submits
  const selfComment = await savePmsComment(db, actorFor(appraisee), {
    cycleId,
    role: PmsCommentRole.Appraisee,
    body:
      'Delivered on the main objectives for the year. Contributions span operational ' +
      'improvements, cross-team collaboration, and mentorship. Happy with the overall direction.',
  });
  if (!selfComment.ok) throw new Error(`self comment: ${selfComment.error}`);
  const submitSelf = await submitSelfReview(db, actorFor(appraisee), { cycleId });
  if (!submitSelf.ok) throw new Error(`submit self-review: ${submitSelf.error}`);
}

async function seedAppraiserData(
  cycleId: string,
  appraiser: Actor,
  pmsId: string,
  behaviouralDims: Array<{ code: string; anchors: string[] }>,
): Promise<void> {
  // Part I: final KRA ratings
  const kras = await db.select().from(kra).where(eq(kra.cycleId, cycleId));
  const ratings = kras.map((k, i) => ({
    kraId: k.id,
    resultAchieved: 'Delivered consistently against target with evidence in quarterly reviews.',
    finalRating: (3 + (i % 2)) as 1 | 2 | 3 | 4 | 5,
  }));
  const rKra = await savePmsKraRatings(db, appraiser, { cycleId, ratings });
  if (!rKra.ok) throw new Error(`save kra ratings: ${rKra.error}`);

  // Part II: 22 behavioural ratings
  const bRatings = behaviouralDims.map((d, i) => {
    const rating = 3 + ((i % 3) - 1);
    return {
      dimensionCode: d.code,
      rating1to5: rating,
      rubricAnchorText: d.anchors[rating - 1] ?? d.anchors[2]!,
    };
  });
  const rB = await saveBehaviouralRatings(db, appraiser, {
    cycleId,
    ratings: bRatings,
  });
  if (!rB.ok) throw new Error(`save behavioural: ${rB.error}`);

  // Part III: contributions
  const rC = await saveStaffContributions(db, appraiser, {
    cycleId,
    contributions: CONTRIBUTIONS,
  });
  if (!rC.ok) throw new Error(`save contributions: ${rC.error}`);

  // Part V: career + growth
  const rCar = await saveCareerDevelopment(db, appraiser, {
    cycleId,
    potentialWindow: PotentialWindow.OneToTwoYears,
    readyIn: '12-18 months with exposure to cross-functional stretch projects',
    comments: 'Candidate for broader scope in the next cycle.',
  });
  if (!rCar.ok) throw new Error(`save career: ${rCar.error}`);
  const rG = await savePersonalGrowth(db, appraiser, {
    cycleId,
    trainingNeeds: 'Stakeholder-management, executive communication, presentation skills.',
    comments: 'Recommend a targeted training program plus shadowing opportunities.',
  });
  if (!rG.ok) throw new Error(`save growth: ${rG.error}`);

  // Part VI(a): appraiser comment
  const cComment = await savePmsComment(db, appraiser, {
    cycleId,
    role: PmsCommentRole.Appraiser,
    body: 'Overall strong contributor. Ready for expanded scope in the next cycle.',
  });
  if (!cComment.ok) throw new Error(`appraiser comment: ${cComment.error}`);
}

async function driveToAwaitingNextLevel(
  hra: StaffRow,
  appraisee: StaffRow,
  appraiser: StaffRow | null,
  cycleId: string,
  pmsId: string,
  dims: Array<{ code: string; anchors: string[] }>,
): Promise<void> {
  await driveToPmsAwaitingAppraiser(hra, appraisee, appraiser, cycleId);
  const appraiserActor = appraiser ? actorFor(appraiser, ['appraiser']) : hraActor(hra);
  await seedAppraiserData(cycleId, appraiserActor, pmsId, dims);
  const submit = await submitAppraiserRating(db, appraiserActor, { cycleId });
  if (!submit.ok) throw new Error(`submit appraiser: ${submit.error}`);
}

async function driveToAwaitingHra(
  hra: StaffRow,
  appraisee: StaffRow,
  appraiser: StaffRow | null,
  nextLevel: StaffRow | null,
  cycleId: string,
  pmsId: string,
  dims: Array<{ code: string; anchors: string[] }>,
): Promise<void> {
  await driveToAwaitingNextLevel(hra, appraisee, appraiser, cycleId, pmsId, dims);

  const nl = nextLevel ?? hra;
  const nlActor = actorFor(nl, ['next_level']);
  const nlComment = await savePmsComment(db, nlActor, {
    cycleId,
    role: PmsCommentRole.NextLevel,
    body: 'Endorse the appraiser rating. Recommend continued investment in development.',
  });
  if (!nlComment.ok) throw new Error(`nl comment: ${nlComment.error}`);
  const submit = await submitNextLevel(db, nlActor, { cycleId });
  if (!submit.ok) throw new Error(`submit next-level: ${submit.error}`);
}

async function driveToFinalized(
  hra: StaffRow,
  appraisee: StaffRow,
  appraiser: StaffRow | null,
  nextLevel: StaffRow | null,
  cycleId: string,
  pmsId: string,
  dims: Array<{ code: string; anchors: string[] }>,
): Promise<void> {
  await driveToAwaitingHra(hra, appraisee, appraiser, nextLevel, cycleId, pmsId, dims);
  const finalize = await finalizePms(db, hraActor(hra), { cycleId });
  if (!finalize.ok) throw new Error(`finalize: ${finalize.error}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[seed-cycles] target FY: ${DEMO_FY}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  // Boot pg-boss in this process so the notifications dispatcher's boss.send
  // calls succeed during the seed. Without this, pg-boss returns an error
  // that surfaces as "Cannot destructure property 'rows'…" deep inside
  // transitions and the seed aborts.
  if (!DRY_RUN) {
    console.log('[seed-cycles] starting pg-boss client…');
    await startBoss();
  }

  const all = await loadStaff();
  if (all.length === 0) {
    console.error('no staff found — run seed-malaysian-org.ts first');
    process.exit(1);
  }

  const hra = all.find((s) => s.roles.includes('hra'));
  if (!hra) {
    console.error('no staff with role=hra — re-seed org first');
    process.exit(1);
  }

  // Build a staffId -> StaffRow lookup to resolve managers without extra queries.
  const byId = new Map(all.map((s) => [s.staffId, s]));

  // Dimensions needed for behavioural ratings
  const dims = await db.select().from(behaviouralDimension);
  const dimsSimple = dims.map((d) => ({
    code: d.code,
    anchors: d.anchors as string[],
  }));

  // Pick staff slices. We iterate by a stable order and carve off chunks.
  // Staff with no manager (CEO) or whose manager has no manager (VPs) go to
  // the "leave alone" bucket so the full appraiser + next-level chain always
  // has a real actor. This removes the top two tiers automatically.
  const eligible = all.filter((s) => {
    if (!s.managerId) return false;
    const mgr = byId.get(s.managerId);
    if (!mgr) return false;
    if (!mgr.managerId) return false;
    const nl = byId.get(mgr.managerId);
    return !!nl;
  });

  // Every eligible staff reaches mid_year_done at minimum. No kra_drafting
  // or mid_year_submitted bucket — the goal is a complete mid-year report.
  const plan: Record<string, StaffRow[]> = {
    finalized: eligible.slice(0, 5),
    awaitingHra: eligible.slice(5, 10),
    awaitingNextLevel: eligible.slice(10, 15),
    awaitingAppraiser: eligible.slice(15, 20),
    pmsSelfReview: eligible.slice(20, 25),
    midYearDone: eligible.slice(25),
  };

  for (const [bucket, members] of Object.entries(plan)) {
    console.log(`[seed-cycles] bucket ${bucket}: ${members.length} staff`);
    for (const m of members) {
      console.log(`             · ${m.name}`);
    }
  }

  if (DRY_RUN) {
    console.log('[seed-cycles] dry-run complete');
    return;
  }

  async function ensureCycle(staffId: string): Promise<string> {
    const [existing] = await db
      .select()
      .from(performanceCycle)
      .where(eq(performanceCycle.staffId, staffId));
    if (existing && existing.fy === DEMO_FY) return existing.id;
    const [row] = await db
      .insert(performanceCycle)
      .values({ staffId, fy: DEMO_FY, state: CycleState.KraDrafting })
      .returning();
    return row!.id;
  }

  async function pmsIdFor(cycleId: string): Promise<string> {
    const res = await db.execute(sql`
      select id from pms_assessment where cycle_id = ${cycleId}::uuid limit 1
    `);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      id: string;
    }>;
    return rows[0]?.id ?? '';
  }

  let completed = 0;
  let failed = 0;

  async function runOne(bucket: string, s: StaffRow, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      completed++;
      console.log(`  ✓ ${bucket} — ${s.name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${bucket} — ${s.name}: ${(err as Error).message}`);
    }
  }

  for (const s of plan.finalized!) {
    await runOne('finalized', s, async () => {
      const cycleId = await ensureCycle(s.staffId);
      const appraiser = s.managerId ? (byId.get(s.managerId) ?? null) : null;
      const nextLevel = appraiser?.managerId ? (byId.get(appraiser.managerId) ?? null) : null;
      await driveToFinalized(
        hra,
        s,
        appraiser,
        nextLevel,
        cycleId,
        await pmsIdFor(cycleId),
        dimsSimple,
      );
    });
  }

  for (const s of plan.awaitingHra!) {
    await runOne('awaitingHra', s, async () => {
      const cycleId = await ensureCycle(s.staffId);
      const appraiser = s.managerId ? (byId.get(s.managerId) ?? null) : null;
      const nextLevel = appraiser?.managerId ? (byId.get(appraiser.managerId) ?? null) : null;
      await driveToAwaitingHra(
        hra,
        s,
        appraiser,
        nextLevel,
        cycleId,
        await pmsIdFor(cycleId),
        dimsSimple,
      );
    });
  }

  for (const s of plan.awaitingNextLevel!) {
    await runOne('awaitingNextLevel', s, async () => {
      const cycleId = await ensureCycle(s.staffId);
      const appraiser = s.managerId ? (byId.get(s.managerId) ?? null) : null;
      await driveToAwaitingNextLevel(
        hra,
        s,
        appraiser,
        cycleId,
        await pmsIdFor(cycleId),
        dimsSimple,
      );
    });
  }

  for (const s of plan.awaitingAppraiser!) {
    await runOne('awaitingAppraiser', s, async () => {
      const cycleId = await ensureCycle(s.staffId);
      const appraiser = s.managerId ? (byId.get(s.managerId) ?? null) : null;
      await driveToPmsAwaitingAppraiser(hra, s, appraiser, cycleId);
    });
  }

  for (const s of plan.pmsSelfReview!) {
    await runOne('pmsSelfReview', s, async () => {
      const cycleId = await ensureCycle(s.staffId);
      const appraiser = s.managerId ? (byId.get(s.managerId) ?? null) : null;
      await driveToMidYearDone(hra, s, appraiser, cycleId);
      // Open PMS window but leave the appraisee in pms_self_review.
      const open = await openPmsWindow(db, hraActor(hra), { cycleId });
      if (!open.ok) throw new Error(`open pms: ${open.error}`);
    });
  }

  for (const s of plan.midYearDone!) {
    await runOne('midYearDone', s, async () => {
      const cycleId = await ensureCycle(s.staffId);
      const appraiser = s.managerId ? (byId.get(s.managerId) ?? null) : null;
      await driveToMidYearDone(hra, s, appraiser, cycleId);
    });
  }

  // Refresh materialized views so dashboards pick up the new rows.
  console.log('[seed-cycles] refreshing dashboard materialized views…');
  try {
    await db.execute(sql`refresh materialized view concurrently mv_cycle_summary`);
    await db.execute(sql`refresh materialized view concurrently mv_dept_rollup`);
    await db.execute(sql`refresh materialized view concurrently mv_org_rollup`);
  } catch (err) {
    // CONCURRENTLY needs a unique index — fall back to blocking refresh.
    console.log('  concurrent refresh failed; falling back to blocking refresh');
    await db.execute(sql`refresh materialized view mv_cycle_summary`);
    await db.execute(sql`refresh materialized view mv_dept_rollup`);
    await db.execute(sql`refresh materialized view mv_org_rollup`);
  }

  console.log(`\n[seed-cycles] done — ${completed} completed, ${failed} failed`);
  process.exit(0);
}

await main();
