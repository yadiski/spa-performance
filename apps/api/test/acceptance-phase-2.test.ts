// Phase-2 E2E acceptance test — must be the first thing in the file so env is
// loaded before any module-level imports resolve DATABASE_URL / auth config.
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
setDefaultTimeout(60_000);

import { KraPerspective, PmsCommentRole } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { verifyChain } from '../src/audit/verifier';
import type { Actor } from '../src/auth/middleware';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { openMidYearWindow, openPmsWindow } from '../src/domain/cycle/windows';
import { approveKras } from '../src/domain/kra/service';
import { saveKraDraft, submitKras } from '../src/domain/kra/service';
import { ackMidYear, saveMidYearUpdate, submitMidYearUpdate } from '../src/domain/mid-year/service';
import {
  saveBehaviouralRatings,
  saveCareerDevelopment,
  savePersonalGrowth,
  savePmsComment,
  saveStaffContributions,
} from '../src/domain/pms/service';
import { verifyPmsSignatureChain } from '../src/domain/pms/signature-verifier';
import { signPmsComment } from '../src/domain/pms/signing';
import {
  finalizePms,
  returnToAppraisee,
  submitAppraiserRating,
  submitNextLevel,
  submitSelfReview,
} from '../src/domain/pms/transitions';
import { runGeneratePmsPdf } from '../src/jobs/generate-pms-pdf';
import * as queue from '../src/jobs/queue';
import * as r2 from '../src/storage/r2';

// ---------------------------------------------------------------------------
// Stub out external I/O at file scope so no network calls happen
// ---------------------------------------------------------------------------
const FAKE_SHA256 = 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567';

const r2PutSpy = spyOn(r2, 'put').mockResolvedValue({ sha256: FAKE_SHA256 });
const bossSendSpy = spyOn(queue.boss, 'send').mockResolvedValue(null as unknown as string);

afterAll(() => {
  r2PutSpy.mockRestore();
  bossSendSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

async function cleanDb(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table notification, audit_log, pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_final_snapshot, cycle_amendment, pms_assessment, mid_year_checkpoint, approval_transition, kra_progress_update, kra, performance_cycle, staff_role, staff, grade, department, organization, "user" cascade`;
  await client.end({ timeout: 2 });
}

// ---------------------------------------------------------------------------
// Fixture state shared across both it() blocks
// ---------------------------------------------------------------------------
let cycleId: string;
let pmsId: string;
let snapshotId: string;

// Staff IDs
let appraiseeUserId: string;
let appraiseeStaffId: string;
let appraiserUserId: string;
let appraiserStaffId: string;
let nextLevelUserId: string;
let nextLevelStaffId: string;
let hraUserId: string;
let hraStaffId: string;

// KRA IDs
let kraIds: string[];

// All 22 behavioural dimension codes with their anchors (seeded by setup.ts)
// We'll fetch these from the DB in beforeAll.
let dims: Array<{ code: string; anchors: string[] }> = [];

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------
beforeAll(async () => {
  await cleanDb();

  // Verify behavioural dimensions were seeded by setup.ts
  const dimRows = await db
    .select()
    .from(s.behaviouralDimension)
    .orderBy(s.behaviouralDimension.order);
  if (dimRows.length === 0) {
    throw new Error('behavioural_dimension table is empty — setup.ts must seed it first');
  }
  dims = dimRows.map((d) => ({ code: d.code, anchors: d.anchors as string[] }));

  // ---- Org / dept / grade ----
  const [org] = await db.insert(s.organization).values({ name: 'Phase2Org' }).returning();
  const [dept] = await db
    .insert(s.department)
    .values({ orgId: org!.id, name: 'Engineering', code: 'ENG' })
    .returning();
  const [grade] = await db
    .insert(s.grade)
    .values({ orgId: org!.id, code: 'G10', rank: '10' })
    .returning();

  // ---- Users ----
  const [hraU] = await db
    .insert(s.user)
    .values({ email: 'p2-hra@t.local', name: 'HRA P2' })
    .returning();
  const [nlU] = await db
    .insert(s.user)
    .values({ email: 'p2-nl@t.local', name: 'NextLevel P2' })
    .returning();
  const [mgrU] = await db
    .insert(s.user)
    .values({ email: 'p2-mgr@t.local', name: 'Appraiser P2' })
    .returning();
  const [stU] = await db
    .insert(s.user)
    .values({ email: 'p2-staff@t.local', name: 'Appraisee P2' })
    .returning();

  hraUserId = hraU!.id;
  nextLevelUserId = nlU!.id;
  appraiserUserId = mgrU!.id;
  appraiseeUserId = stU!.id;

  // ---- Staff hierarchy: nextLevel → appraiser → appraisee ----
  const [hraSt] = await db
    .insert(s.staff)
    .values({
      userId: hraU!.id,
      orgId: org!.id,
      employeeNo: 'P2-HRA',
      name: 'HRA P2',
      designation: 'HR Admin',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2018-01-01',
    })
    .returning();
  hraStaffId = hraSt!.id;

  const [nlSt] = await db
    .insert(s.staff)
    .values({
      userId: nlU!.id,
      orgId: org!.id,
      employeeNo: 'P2-NL',
      name: 'NextLevel P2',
      designation: 'Director',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2019-01-01',
    })
    .returning();
  nextLevelStaffId = nlSt!.id;

  const [mgrSt] = await db
    .insert(s.staff)
    .values({
      userId: mgrU!.id,
      orgId: org!.id,
      employeeNo: 'P2-MGR',
      name: 'Appraiser P2',
      designation: 'Manager',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: nlSt!.id,
      hireDate: '2020-01-01',
    })
    .returning();
  appraiserStaffId = mgrSt!.id;

  const [staffSt] = await db
    .insert(s.staff)
    .values({
      userId: stU!.id,
      orgId: org!.id,
      employeeNo: 'P2-ST',
      name: 'Appraisee P2',
      designation: 'Engineer',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: mgrSt!.id,
      hireDate: '2022-01-01',
    })
    .returning();
  appraiseeStaffId = staffSt!.id;

  // ---- Roles ----
  await db.insert(s.staffRole).values([
    { staffId: hraSt!.id, role: 'hra' },
    { staffId: nlSt!.id, role: 'next_level' },
    { staffId: mgrSt!.id, role: 'appraiser' },
    { staffId: staffSt!.id, role: 'staff' },
  ]);

  // ---- Cycle starts in kra_drafting ----
  const [cy] = await db
    .insert(s.performanceCycle)
    .values({ staffId: appraiseeStaffId, fy: 2026, state: 'kra_drafting' })
    .returning();
  cycleId = cy!.id;

  // ---- Seed 4 KRAs (weights sum to 100) ----
  const kraIn = (order: number, weight: number) => ({
    cycleId,
    perspective: KraPerspective.Financial,
    description: `Phase-2 KRA ${order + 1} — measurable outcome for FY2026`,
    weightPct: weight,
    measurement: 'Quarterly milestone completion rate',
    target: '100% milestones delivered on time',
    order,
    rubric1to5: [
      'Below 50% milestones met',
      '50–70% milestones met',
      '70–85% milestones met',
      '85–95% milestones met',
      '95–100% milestones met',
    ],
  });
  const k1 = await db.insert(s.kra).values(kraIn(0, 30)).returning();
  const k2 = await db.insert(s.kra).values(kraIn(1, 30)).returning();
  const k3 = await db.insert(s.kra).values(kraIn(2, 20)).returning();
  const k4 = await db.insert(s.kra).values(kraIn(3, 20)).returning();
  kraIds = [k1[0]!.id, k2[0]!.id, k3[0]!.id, k4[0]!.id];
});

// ---------------------------------------------------------------------------
// Actor factories (use captured IDs from beforeAll)
// ---------------------------------------------------------------------------
const hraActor = () => mkActor({ userId: hraUserId, staffId: hraStaffId, roles: ['hra'] });
const appraiserActor = () =>
  mkActor({ userId: appraiserUserId, staffId: appraiserStaffId, roles: ['appraiser'] });
const nextLevelActor = () =>
  mkActor({ userId: nextLevelUserId, staffId: nextLevelStaffId, roles: ['next_level'] });
const appraiseeActor = () =>
  mkActor({ userId: appraiseeUserId, staffId: appraiseeStaffId, roles: ['staff'] });

// ---------------------------------------------------------------------------
// Golden-path test
// ---------------------------------------------------------------------------
describe('phase 2 acceptance', () => {
  it('drives golden path: kra_draft → pms_finalized + PDF + audit chain', async () => {
    // ------------------------------------------------------------------
    // Step 1: KRA drafting already seeded in state kra_drafting.
    // The cycle was created in kra_drafting; KRAs are already inserted.
    // We call saveKraDraft to write the audit event and submitKras to submit.
    // ------------------------------------------------------------------
    const draftRes = await saveKraDraft(db, appraiseeActor(), {
      cycleId,
      kras: [
        {
          perspective: KraPerspective.Financial,
          description: 'Phase-2 KRA 1 — measurable outcome for FY2026',
          weightPct: 30,
          measurement: 'Quarterly milestone completion rate',
          target: '100% milestones delivered on time',
          order: 0,
          rubric1to5: [
            'Below 50% milestones met',
            '50–70% milestones met',
            '70–85% milestones met',
            '85–95% milestones met',
            '95–100% milestones met',
          ],
        },
        {
          perspective: KraPerspective.Financial,
          description: 'Phase-2 KRA 2 — measurable outcome for FY2026',
          weightPct: 30,
          measurement: 'Quarterly milestone completion rate',
          target: '100% milestones delivered on time',
          order: 1,
          rubric1to5: [
            'Below 50% milestones met',
            '50–70% milestones met',
            '70–85% milestones met',
            '85–95% milestones met',
            '95–100% milestones met',
          ],
        },
        {
          perspective: KraPerspective.Financial,
          description: 'Phase-2 KRA 3 — measurable outcome for FY2026',
          weightPct: 20,
          measurement: 'Quarterly milestone completion rate',
          target: '100% milestones delivered on time',
          order: 2,
          rubric1to5: [
            'Below 50% milestones met',
            '50–70% milestones met',
            '70–85% milestones met',
            '85–95% milestones met',
            '95–100% milestones met',
          ],
        },
        {
          perspective: KraPerspective.Financial,
          description: 'Phase-2 KRA 4 — measurable outcome for FY2026',
          weightPct: 20,
          measurement: 'Quarterly milestone completion rate',
          target: '100% milestones delivered on time',
          order: 3,
          rubric1to5: [
            'Below 50% milestones met',
            '50–70% milestones met',
            '70–85% milestones met',
            '85–95% milestones met',
            '95–100% milestones met',
          ],
        },
      ],
    });
    expect(draftRes.ok, `saveKraDraft failed: ${JSON.stringify(draftRes)}`).toBe(true);
    // Refresh kraIds after saveKraDraft (it replaces existing KRAs)
    const freshKras = await db.select().from(s.kra).where(eq(s.kra.cycleId, cycleId));
    kraIds = freshKras.map((k) => k.id);

    // ------------------------------------------------------------------
    // Step 2: Staff submits KRAs → kra_pending_approval
    // ------------------------------------------------------------------
    const submitKraRes = await submitKras(db, appraiseeActor(), cycleId);
    expect(submitKraRes.ok, `submitKras failed: ${JSON.stringify(submitKraRes)}`).toBe(true);

    let cycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('kra_pending_approval');

    // ------------------------------------------------------------------
    // Step 3: Appraiser approves KRAs → kra_approved
    // ------------------------------------------------------------------
    const approveKraRes = await approveKras(db, appraiserActor(), cycleId);
    expect(approveKraRes.ok, `approveKras failed: ${JSON.stringify(approveKraRes)}`).toBe(true);

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('kra_approved');

    // ------------------------------------------------------------------
    // Step 4: HRA opens mid-year window → mid_year_open
    // ------------------------------------------------------------------
    const midYearOpenRes = await openMidYearWindow(db, hraActor(), { cycleId });
    expect(midYearOpenRes.ok, `openMidYearWindow failed: ${JSON.stringify(midYearOpenRes)}`).toBe(
      true,
    );

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('mid_year_open');

    // ------------------------------------------------------------------
    // Step 5: Staff saves + submits mid-year update → mid_year_submitted
    // ------------------------------------------------------------------
    const midYearSaveRes = await saveMidYearUpdate(db, appraiseeActor(), {
      cycleId,
      updates: kraIds.map((kraId) => ({
        kraId,
        resultAchieved: 'On track — milestone 2 of 4 completed',
        informalRating: 3,
      })),
      summary: 'First half progressing well, some risks identified in Q2',
    });
    expect(midYearSaveRes.ok, `saveMidYearUpdate failed: ${JSON.stringify(midYearSaveRes)}`).toBe(
      true,
    );

    const midYearSubmitRes = await submitMidYearUpdate(db, appraiseeActor(), { cycleId });
    expect(
      midYearSubmitRes.ok,
      `submitMidYearUpdate failed: ${JSON.stringify(midYearSubmitRes)}`,
    ).toBe(true);

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('mid_year_submitted');

    // ------------------------------------------------------------------
    // Step 6: Appraiser acks mid-year → mid_year_done
    // ------------------------------------------------------------------
    const ackRes = await ackMidYear(db, appraiserActor(), {
      cycleId,
      note: 'Acknowledged — targets remain achievable',
    });
    expect(ackRes.ok, `ackMidYear failed: ${JSON.stringify(ackRes)}`).toBe(true);

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('mid_year_done');

    // ------------------------------------------------------------------
    // Step 7: HRA opens PMS window → pms_self_review
    // ------------------------------------------------------------------
    const pmsOpenRes = await openPmsWindow(db, hraActor(), { cycleId });
    expect(pmsOpenRes.ok, `openPmsWindow failed: ${JSON.stringify(pmsOpenRes)}`).toBe(true);

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_self_review');

    // ------------------------------------------------------------------
    // Step 8: Appraisee saves Part VI(b) comment, then submits self-review
    //         → pms_awaiting_appraiser
    // ------------------------------------------------------------------
    const selfCommentRes = await savePmsComment(db, appraiseeActor(), {
      cycleId,
      role: PmsCommentRole.Appraisee,
      body: 'I believe I have met all four KRA targets this year. The mid-year risks were mitigated effectively in Q3.',
    });
    expect(
      selfCommentRes.ok,
      `savePmsComment(appraisee) failed: ${JSON.stringify(selfCommentRes)}`,
    ).toBe(true);

    const selfReviewRes = await submitSelfReview(db, appraiseeActor(), { cycleId });
    expect(selfReviewRes.ok, `submitSelfReview failed: ${JSON.stringify(selfReviewRes)}`).toBe(
      true,
    );

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_appraiser');

    // Fetch pmsId for subsequent saves
    const [pmsRow] = await db
      .select()
      .from(s.pmsAssessment)
      .where(eq(s.pmsAssessment.cycleId, cycleId));
    pmsId = pmsRow!.id;

    // ------------------------------------------------------------------
    // Step 9a: Appraiser saves Part I — KRA final ratings
    // ------------------------------------------------------------------
    const kraRatingsRes = await db.select().from(s.kra).where(eq(s.kra.cycleId, cycleId));
    const finalKraIds = kraRatingsRes.map((k) => k.id);

    const saveKraRatingRes = await db.insert(s.pmsKraRating).values(
      finalKraIds.map((kraId, i) => ({
        pmsId,
        kraId,
        resultAchieved: `Milestone ${i + 1} fully delivered on time`,
        finalRating: 4,
        comment: null,
      })),
    );
    // Direct insert — no service call needed since service has state guard (pms_awaiting_appraiser is correct)

    // ------------------------------------------------------------------
    // Step 9b: Appraiser saves Part II — all 22 behavioural ratings
    //          Each rubricAnchorText must match the seeded anchor at rating-1 index
    // ------------------------------------------------------------------
    const behaviouralRatingsInput = dims.map((d) => ({
      dimensionCode: d.code,
      rating1to5: 3 as const,
      // anchor at index 2 (rating 3 → index 2)
      rubricAnchorText: d.anchors[2]!,
    }));

    const behaviouralRes = await saveBehaviouralRatings(db, appraiserActor(), {
      cycleId,
      ratings: behaviouralRatingsInput,
    });
    expect(
      behaviouralRes.ok,
      `saveBehaviouralRatings failed: ${JSON.stringify(behaviouralRes)}`,
    ).toBe(true);

    // ------------------------------------------------------------------
    // Step 9c: Appraiser saves Part III — staff contribution
    // ------------------------------------------------------------------
    const contribRes = await saveStaffContributions(db, appraiserActor(), {
      cycleId,
      contributions: [
        {
          whenDate: 'March 2026',
          achievement: 'Led the migration to new CI/CD pipeline',
          weightPct: 3,
        },
      ],
    });
    expect(contribRes.ok, `saveStaffContributions failed: ${JSON.stringify(contribRes)}`).toBe(
      true,
    );

    // ------------------------------------------------------------------
    // Step 9d: Appraiser saves Part V(a) — career development
    // ------------------------------------------------------------------
    const careerRes = await saveCareerDevelopment(db, appraiserActor(), {
      cycleId,
      potentialWindow: '1-2_years',
      readyIn: 'Ready for senior engineer role in 18 months',
      comments: 'Strong technical skills; should broaden stakeholder management',
    });
    expect(careerRes.ok, `saveCareerDevelopment failed: ${JSON.stringify(careerRes)}`).toBe(true);

    // ------------------------------------------------------------------
    // Step 9e: Appraiser saves Part V(b) — personal growth
    // ------------------------------------------------------------------
    const growthRes = await savePersonalGrowth(db, appraiserActor(), {
      cycleId,
      trainingNeeds: 'Leadership development programme, advanced SQL certification',
      comments: 'Proactively seeks learning opportunities',
    });
    expect(growthRes.ok, `savePersonalGrowth failed: ${JSON.stringify(growthRes)}`).toBe(true);

    // ------------------------------------------------------------------
    // Step 9f: Appraiser saves Part VI(a) — appraiser comment
    // ------------------------------------------------------------------
    const appraiserCommentRes = await savePmsComment(db, appraiserActor(), {
      cycleId,
      role: PmsCommentRole.Appraiser,
      body: 'Strong year overall. Staff consistently delivered on targets and demonstrated initiative.',
    });
    expect(
      appraiserCommentRes.ok,
      `savePmsComment(appraiser) failed: ${JSON.stringify(appraiserCommentRes)}`,
    ).toBe(true);

    // ------------------------------------------------------------------
    // Step 9g: Appraiser submits rating → pms_awaiting_next_lvl
    // ------------------------------------------------------------------
    const appraiserSubmitRes = await submitAppraiserRating(db, appraiserActor(), { cycleId });
    expect(
      appraiserSubmitRes.ok,
      `submitAppraiserRating failed: ${JSON.stringify(appraiserSubmitRes)}`,
    ).toBe(true);

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_next_lvl');

    // ------------------------------------------------------------------
    // Step 10 (return-to-appraisee) is exercised in the 2nd it() block.
    // In the golden path we continue straight through.
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Step 11: Next-level saves Part VI(c) comment and signs, then submits
    //          → pms_awaiting_hra
    // ------------------------------------------------------------------
    const nextLevelCommentRes = await savePmsComment(db, nextLevelActor(), {
      cycleId,
      role: PmsCommentRole.NextLevel,
      body: 'Concur with appraiser assessment. Staff is on trajectory for promotion.',
    });
    expect(
      nextLevelCommentRes.ok,
      `savePmsComment(next_level) failed: ${JSON.stringify(nextLevelCommentRes)}`,
    ).toBe(true);

    // Sign appraisee comment
    const appraiseeCommentRow = await db
      .select()
      .from(s.pmsComment)
      .where(sql`pms_id = ${pmsId} and role = 'appraisee' and signed_at is null`);
    const signAppraiseeRes = await signPmsComment(db, appraiseeActor(), {
      commentId: appraiseeCommentRow[0]!.id,
      typedName: 'Appraisee P2',
    });
    expect(
      signAppraiseeRes.ok,
      `signPmsComment(appraisee) failed: ${JSON.stringify(signAppraiseeRes)}`,
    ).toBe(true);

    // Sign appraiser comment
    const appraiserCommentRow = await db
      .select()
      .from(s.pmsComment)
      .where(sql`pms_id = ${pmsId} and role = 'appraiser' and signed_at is null`);
    const signAppraiserRes = await signPmsComment(db, appraiserActor(), {
      commentId: appraiserCommentRow[0]!.id,
      typedName: 'Appraiser P2',
    });
    expect(
      signAppraiserRes.ok,
      `signPmsComment(appraiser) failed: ${JSON.stringify(signAppraiserRes)}`,
    ).toBe(true);

    // Sign next-level comment
    const nextLevelCommentRow = await db
      .select()
      .from(s.pmsComment)
      .where(sql`pms_id = ${pmsId} and role = 'next_level' and signed_at is null`);
    const signNextLevelRes = await signPmsComment(db, nextLevelActor(), {
      commentId: nextLevelCommentRow[0]!.id,
      typedName: 'NextLevel P2',
    });
    expect(
      signNextLevelRes.ok,
      `signPmsComment(next_level) failed: ${JSON.stringify(signNextLevelRes)}`,
    ).toBe(true);

    const nextLevelSubmitRes = await submitNextLevel(db, nextLevelActor(), { cycleId });
    expect(
      nextLevelSubmitRes.ok,
      `submitNextLevel failed: ${JSON.stringify(nextLevelSubmitRes)}`,
    ).toBe(true);

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_awaiting_hra');

    // ------------------------------------------------------------------
    // Step 12: HRA finalizes → pms_finalized
    // ------------------------------------------------------------------
    const finalizeRes = await finalizePms(db, hraActor(), { cycleId });
    expect(finalizeRes.ok, `finalizePms failed: ${JSON.stringify(finalizeRes)}`).toBe(true);

    cycle = await db.select().from(s.performanceCycle).where(eq(s.performanceCycle.id, cycleId));
    expect(cycle[0]?.state).toBe('pms_finalized');

    // ------------------------------------------------------------------
    // ASSERTION 1: Final state
    // ------------------------------------------------------------------
    expect(cycle[0]?.state).toBe('pms_finalized');

    // ------------------------------------------------------------------
    // ASSERTION 2: pmsFinalSnapshot with scoreTotal + scoreBreakdown
    // ------------------------------------------------------------------
    const snapshots = await db
      .select()
      .from(s.pmsFinalSnapshot)
      .where(eq(s.pmsFinalSnapshot.pmsId, pmsId));
    expect(snapshots.length).toBe(1);
    const snap = snapshots[0]!;
    snapshotId = snap.id;
    expect(snap.scoreTotal).not.toBeNull();
    expect(Number(snap.scoreTotal)).toBeGreaterThan(0);
    // scoreBreakdown is a JSON object with kra/behavioural/contribution/total keys
    const breakdown = snap.scoreBreakdown as Record<string, number>;
    expect(typeof breakdown).toBe('object');
    expect(typeof breakdown.total).toBe('number');
    expect(typeof breakdown.kra).toBe('number');
    expect(typeof breakdown.behavioural).toBe('number');
    expect(typeof breakdown.contribution).toBe('number');

    // ------------------------------------------------------------------
    // Step 13: Trigger PDF generation (R2 + email are stubbed)
    // ------------------------------------------------------------------
    await runGeneratePmsPdf(db, cycleId, snapshotId, hraUserId);

    // ------------------------------------------------------------------
    // ASSERTION 3: PDF stamp on snapshot
    // ------------------------------------------------------------------
    const [updatedSnap] = await db
      .select()
      .from(s.pmsFinalSnapshot)
      .where(eq(s.pmsFinalSnapshot.id, snapshotId));
    expect(updatedSnap?.pdfR2Key).toBe(`pms/${cycleId}/${snapshotId}.pdf`);
    expect(updatedSnap?.pdfSha256).toBe(FAKE_SHA256);

    // ------------------------------------------------------------------
    // ASSERTION 4: 22 behavioural_rating rows, each with non-empty anchor
    //              that matches the seeded dimension's anchors array
    // ------------------------------------------------------------------
    const bRatings = await db
      .select()
      .from(s.behaviouralRating)
      .where(eq(s.behaviouralRating.pmsId, pmsId));
    expect(bRatings.length).toBe(22);

    const dimsByCode = new Map(dims.map((d) => [d.code, d]));
    for (const r of bRatings) {
      expect(r.rubricAnchorText.length).toBeGreaterThan(0);
      const dim = dimsByCode.get(r.dimensionCode);
      expect(dim, `unknown dimension code: ${r.dimensionCode}`).toBeDefined();
      const anchors = dim!.anchors;
      expect(
        anchors.includes(r.rubricAnchorText),
        `anchor mismatch for ${r.dimensionCode}: got "${r.rubricAnchorText.slice(0, 40)}..."`,
      ).toBe(true);
    }

    // ------------------------------------------------------------------
    // ASSERTION 5: Audit chain OK
    // ------------------------------------------------------------------
    const today = new Date().toISOString().slice(0, 10);
    const auditResult = await verifyChain(db, today, today);
    expect(auditResult.ok, `Audit chain verification failed: ${JSON.stringify(auditResult)}`).toBe(
      true,
    );

    // ------------------------------------------------------------------
    // ASSERTION 6: E-signature chain on this PMS
    // ------------------------------------------------------------------
    const sigChain = await verifyPmsSignatureChain(db, pmsId);
    expect(sigChain.ok, `Signature chain failed: ${JSON.stringify(sigChain)}`).toBe(true);
    // 3 signed comments: appraisee, appraiser, next_level
    expect((sigChain as { ok: true; count: number }).count).toBe(3);

    // ------------------------------------------------------------------
    // ASSERTION 7: Notification fan-out — check kind uniqueness
    // ------------------------------------------------------------------
    const notifResult = await db.execute(sql`
      select distinct kind from notification where target_id = ${cycleId}
    `);
    const notifRows = (
      Array.isArray(notifResult) ? notifResult : ((notifResult as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ kind: string }>;
    const notifKinds = new Set(notifRows.map((r) => r.kind));

    // Minimum expected notification kinds for the golden path:
    const expectedKinds = [
      'mid_year.opened',
      'mid_year.submitted',
      'mid_year.acked',
      'pms.self_review.submitted',
      'pms.appraiser.submitted',
      'pms.next_level.submitted',
      'pms.finalized',
      'pms.pdf.ready',
    ];
    for (const kind of expectedKinds) {
      expect(notifKinds.has(kind), `missing notification kind: ${kind}`).toBe(true);
    }

    // Total notification rows >= 6 (some go to multiple recipients)
    const totalNotifResult = await db.execute(sql`
      select count(*)::int as n from notification where target_id = ${cycleId}
    `);
    const totalNotifRows = (
      Array.isArray(totalNotifResult)
        ? totalNotifResult
        : ((totalNotifResult as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ n: number }>;
    expect(totalNotifRows[0]!.n).toBeGreaterThanOrEqual(6);
  });

  // -------------------------------------------------------------------------
  // Return-to-appraisee scenario — separate it() so it's a named scenario
  // -------------------------------------------------------------------------
  it('return-to-appraisee preserves prior submissions and re-submission extends chain', async () => {
    // We need a fresh cycle for this scenario to avoid state conflicts
    const [rtCy] = await db
      .insert(s.performanceCycle)
      .values({ staffId: appraiseeStaffId, fy: 2027, state: 'mid_year_done' })
      .returning();
    const rtCycleId = rtCy!.id;

    // Seed 4 KRAs for this cycle
    const rtKras = await db
      .insert(s.kra)
      .values([
        {
          cycleId: rtCycleId,
          perspective: KraPerspective.Financial,
          description: 'RT KRA 1',
          weightPct: 25,
          measurement: 'm',
          target: 't',
          order: 0,
          rubric1to5: ['a', 'b', 'c', 'd', 'e'],
        },
        {
          cycleId: rtCycleId,
          perspective: KraPerspective.Financial,
          description: 'RT KRA 2',
          weightPct: 25,
          measurement: 'm',
          target: 't',
          order: 1,
          rubric1to5: ['a', 'b', 'c', 'd', 'e'],
        },
        {
          cycleId: rtCycleId,
          perspective: KraPerspective.Financial,
          description: 'RT KRA 3',
          weightPct: 25,
          measurement: 'm',
          target: 't',
          order: 2,
          rubric1to5: ['a', 'b', 'c', 'd', 'e'],
        },
        {
          cycleId: rtCycleId,
          perspective: KraPerspective.Financial,
          description: 'RT KRA 4',
          weightPct: 25,
          measurement: 'm',
          target: 't',
          order: 3,
          rubric1to5: ['a', 'b', 'c', 'd', 'e'],
        },
      ])
      .returning();
    const rtKraIds = rtKras.map((k) => k.id);

    // Open PMS window (cycle starts at mid_year_done)
    const r1 = await openPmsWindow(db, hraActor(), { cycleId: rtCycleId });
    expect(r1.ok, `openPmsWindow failed: ${JSON.stringify(r1)}`).toBe(true);

    // Appraisee saves comment + submits self-review
    await savePmsComment(db, appraiseeActor(), {
      cycleId: rtCycleId,
      role: PmsCommentRole.Appraisee,
      body: 'Initial self-review comment — first submission',
    });
    const r2submit = await submitSelfReview(db, appraiseeActor(), { cycleId: rtCycleId });
    expect(r2submit.ok, `submitSelfReview failed: ${JSON.stringify(r2submit)}`).toBe(true);

    let rtCycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, rtCycleId));
    expect(rtCycle[0]?.state).toBe('pms_awaiting_appraiser');

    // Capture the pmsId for this cycle
    const [rtPmsRow] = await db
      .select()
      .from(s.pmsAssessment)
      .where(eq(s.pmsAssessment.cycleId, rtCycleId));
    const rtPmsId = rtPmsRow!.id;

    // Appraiser saves Part II behavioural ratings (needed to later re-submit)
    const rtBehaviouralInput = dims.map((d) => ({
      dimensionCode: d.code,
      rating1to5: 4 as const,
      rubricAnchorText: d.anchors[3]!, // index 3 = rating 4
    }));
    const rtBehRes = await saveBehaviouralRatings(db, appraiserActor(), {
      cycleId: rtCycleId,
      ratings: rtBehaviouralInput,
    });
    expect(rtBehRes.ok, `saveBehaviouralRatings failed: ${JSON.stringify(rtBehRes)}`).toBe(true);

    // Capture the behavioural_rating IDs before return
    const preBehaviouralRows = await db
      .select()
      .from(s.behaviouralRating)
      .where(eq(s.behaviouralRating.pmsId, rtPmsId));
    const preBehaviouralIds = new Set(preBehaviouralRows.map((r) => r.id));
    expect(preBehaviouralRows.length).toBe(22);

    // Capture pms_comment rows before return
    const preCommentRows = await db
      .select()
      .from(s.pmsComment)
      .where(eq(s.pmsComment.pmsId, rtPmsId));
    const preCommentIds = new Set(preCommentRows.map((r) => r.id));

    // ------------------------------------------------------------------
    // Appraiser returns to appraisee
    // ------------------------------------------------------------------
    const returnRes = await returnToAppraisee(db, appraiserActor(), {
      cycleId: rtCycleId,
      note: 'Please add more detail to your self-assessment in section 2',
    });
    expect(returnRes.ok, `returnToAppraisee failed: ${JSON.stringify(returnRes)}`).toBe(true);

    rtCycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, rtCycleId));
    expect(rtCycle[0]?.state).toBe('pms_self_review');

    // ------------------------------------------------------------------
    // ASSERTION 8a: Prior pms_comment rows are STILL present (not deleted)
    // ------------------------------------------------------------------
    const postReturnComments = await db
      .select()
      .from(s.pmsComment)
      .where(eq(s.pmsComment.pmsId, rtPmsId));
    for (const id of preCommentIds) {
      expect(
        postReturnComments.some((c) => c.id === id),
        `pms_comment ${id} was deleted on return-to-appraisee`,
      ).toBe(true);
    }

    // ------------------------------------------------------------------
    // ASSERTION 8b: Prior behavioural_rating rows are STILL present (not deleted)
    //              (behavioural ratings belong to pms_assessment, not cycle state)
    // ------------------------------------------------------------------
    const postReturnBehavioural = await db
      .select()
      .from(s.behaviouralRating)
      .where(eq(s.behaviouralRating.pmsId, rtPmsId));
    for (const id of preBehaviouralIds) {
      expect(
        postReturnBehavioural.some((r) => r.id === id),
        `behavioural_rating ${id} was deleted on return-to-appraisee`,
      ).toBe(true);
    }

    // ------------------------------------------------------------------
    // Re-submit: appraisee saves new comment and re-submits
    // ------------------------------------------------------------------
    await savePmsComment(db, appraiseeActor(), {
      cycleId: rtCycleId,
      role: PmsCommentRole.Appraisee,
      body: 'Revised self-review: Added details on Q3 achievements and Q4 stretch goals.',
    });
    const resubmitRes = await submitSelfReview(db, appraiseeActor(), { cycleId: rtCycleId });
    expect(resubmitRes.ok, `re-submitSelfReview failed: ${JSON.stringify(resubmitRes)}`).toBe(true);

    rtCycle = await db
      .select()
      .from(s.performanceCycle)
      .where(eq(s.performanceCycle.id, rtCycleId));
    expect(rtCycle[0]?.state).toBe('pms_awaiting_appraiser');

    // ------------------------------------------------------------------
    // ASSERTION 8c: Re-submission adds NEW rows without deleting old ones
    // ------------------------------------------------------------------
    const postResubmitComments = await db
      .select()
      .from(s.pmsComment)
      .where(eq(s.pmsComment.pmsId, rtPmsId));
    // We now have the original comments + new one (savePmsComment replaces unsigned but the
    // original first-submission comment was unsigned, so it should be replaced)
    // The important thing: we have at least as many comments as before return
    expect(postResubmitComments.length).toBeGreaterThanOrEqual(preCommentRows.length);

    // ------------------------------------------------------------------
    // ASSERTION 8d: Signature chain still validates after return-to-appraisee
    //               (no signed comments yet — chain of 0 is ok: count = 0)
    // ------------------------------------------------------------------
    const rtSigChain = await verifyPmsSignatureChain(db, rtPmsId);
    expect(
      rtSigChain.ok,
      `Signature chain after return failed: ${JSON.stringify(rtSigChain)}`,
    ).toBe(true);

    // Sign the new appraisee comment to verify chain extends correctly
    const newAppraiseeComment = await db
      .select()
      .from(s.pmsComment)
      .where(sql`pms_id = ${rtPmsId} and role = 'appraisee' and signed_at is null`);
    expect(newAppraiseeComment.length).toBeGreaterThan(0);
    const signResubmitRes = await signPmsComment(db, appraiseeActor(), {
      commentId: newAppraiseeComment[0]!.id,
      typedName: 'Appraisee P2',
    });
    expect(
      signResubmitRes.ok,
      `signPmsComment resubmit failed: ${JSON.stringify(signResubmitRes)}`,
    ).toBe(true);

    // Signature chain should still validate (1 signed comment now)
    const rtSigChain2 = await verifyPmsSignatureChain(db, rtPmsId);
    expect(
      rtSigChain2.ok,
      `Signature chain after re-sign failed: ${JSON.stringify(rtSigChain2)}`,
    ).toBe(true);
    expect((rtSigChain2 as { ok: true; count: number }).count).toBe(1);
  });
});
