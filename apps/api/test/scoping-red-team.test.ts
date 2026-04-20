/**
 * Red-team scoping tests — T43
 *
 * Systematically hits every mutating and read-sensitive Phase-2 endpoint as:
 *   a) an unauthenticated client (expect 401)
 *   b) an authenticated but unrelated staff member (expect 403 or 404)
 *
 * Fixture: one org, two staff — appraisee (owns the cycle) and outsider (no relation).
 * Outsider exercises the 403/404 path; no cookie exercises 401.
 */

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeAll, describe, it, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';
import * as queue from '../src/jobs/queue';
import {
  type ScopingCase,
  type UnauthCase,
  assertScoped,
  assertUnauthenticated,
} from './helpers/assert-scoped';

// Mock pg-boss so no real queue is needed
spyOn(queue.boss, 'send').mockImplementation(async () => null as unknown as string);

const PW = 'correct-horse-battery-staple-T43-scope';

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function signUp(email: string, name: string): Promise<void> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW, name }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed ${res.status}: ${await res.text()}`);
}

async function signIn(email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed ${res.status}: ${await res.text()}`);
  return res.headers.get('set-cookie') ?? '';
}

// ── Fixture ───────────────────────────────────────────────────────────────────

let outsiderCookie: string;
let pmsCycleId: string;
let midYearCycleId: string;
let notifId: string;

beforeAll(async () => {
  // Wipe slate
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table notification, audit_log cascade`;
  await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
  await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
  await client`truncate table mid_year_checkpoint cascade`;
  await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
  await client`truncate table staff_role, staff, grade, department, organization cascade`;
  await client`truncate table "user" cascade`;
  await client.end({ timeout: 2 });

  const ts = Date.now();
  const appraiseeEmail = `scope-appraisee-${ts}@t.local`;
  const outsiderEmail = `scope-outsider-${ts}@t.local`;

  await signUp(appraiseeEmail, 'Appraisee');
  await signUp(outsiderEmail, 'Outsider');

  outsiderCookie = await signIn(outsiderEmail);

  // Resolve user ids
  const getUserId = async (email: string) => {
    const res = await db.execute(sql`select id from "user" where email = ${email}`);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      id: string;
    }>;
    return rows[0]!.id;
  };

  const appraiseeUserId = await getUserId(appraiseeEmail);
  const outsiderUserId = await getUserId(outsiderEmail);

  // Build org
  const [org] = await db.insert(s.organization).values({ name: 'ScopeTestOrg' }).returning();
  const [dept] = await db
    .insert(s.department)
    .values({ orgId: org!.id, code: 'ENG', name: 'Engineering' })
    .returning();
  const [grade] = await db
    .insert(s.grade)
    .values({ orgId: org!.id, code: 'E5', rank: '5' })
    .returning();

  // Appraisee staff
  const [appraiseeStaff] = await db
    .insert(s.staff)
    .values({
      userId: appraiseeUserId,
      orgId: org!.id,
      employeeNo: `APR${ts}`,
      name: 'Appraisee',
      designation: 'Engineer',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2022-01-01',
    })
    .returning();

  // Outsider staff — same org but no manager/report relationship to appraisee
  const [outsiderStaff] = await db
    .insert(s.staff)
    .values({
      userId: outsiderUserId,
      orgId: org!.id,
      employeeNo: `OUT${ts}`,
      name: 'Outsider',
      designation: 'Contractor',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2022-01-01',
    })
    .returning();

  await db.insert(s.staffRole).values([
    { staffId: appraiseeStaff!.id, role: 'staff' },
    { staffId: outsiderStaff!.id, role: 'staff' },
  ]);

  // PMS cycle for appraisee — in pms_self_review so state-based rejections don't mask scoping failures
  const [pmsCycle] = await db
    .insert(s.performanceCycle)
    .values({ staffId: appraiseeStaff!.id, fy: 2026, state: 'pms_self_review' })
    .returning();
  pmsCycleId = pmsCycle!.id;

  // Mid-year cycle in mid_year_open so mid-year endpoints exercise the scoping guard
  const [midYearCycle] = await db
    .insert(s.performanceCycle)
    .values({ staffId: appraiseeStaff!.id, fy: 2025, state: 'mid_year_open' })
    .returning();
  midYearCycleId = midYearCycle!.id;
  // Insert mid_year_checkpoint so the GET /:cycleId endpoint has a real checkpoint
  await db.insert(s.midYearCheckpoint).values({ cycleId: midYearCycleId }).onConflictDoNothing();

  // Notification for appraisee
  const [notif] = await db
    .insert(s.notification)
    .values({
      recipientStaffId: appraiseeStaff!.id,
      kind: 'pms.finalized',
      payload: { msg: 'scope-test' },
      targetType: 'cycle',
      targetId: pmsCycleId,
      readAt: null,
    })
    .returning();
  notifId = notif!.id;
});

// ── Shared placeholder UUIDs ─────────────────────────────────────────────────

const NIL = '00000000-0000-0000-0000-000000000000';

// ── 401 — Unauthenticated tests ───────────────────────────────────────────────

describe('unauthenticated → 401 on every protected route', () => {
  it('PMS routes reject unauthenticated', async () => {
    const cases: UnauthCase[] = [
      { method: 'POST', path: '/api/v1/pms/kra-ratings', body: { cycleId: NIL, ratings: [] } },
      { method: 'POST', path: '/api/v1/pms/behavioural', body: { cycleId: NIL, ratings: [] } },
      {
        method: 'POST',
        path: '/api/v1/pms/contributions',
        body: { cycleId: NIL, contributions: [] },
      },
      {
        method: 'POST',
        path: '/api/v1/pms/career',
        body: { cycleId: NIL, potentialWindow: 'now' },
      },
      { method: 'POST', path: '/api/v1/pms/growth', body: { cycleId: NIL } },
      {
        method: 'POST',
        path: '/api/v1/pms/comment',
        body: { cycleId: NIL, role: 'appraisee', body: 'x' },
      },
      { method: 'POST', path: '/api/v1/pms/open-window', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/pms/submit-self-review', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/pms/submit-appraiser', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/pms/return-to-appraisee', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/pms/submit-next-level', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/pms/return-to-appraiser', body: { cycleId: NIL } },
      {
        method: 'POST',
        path: '/api/v1/pms/finalize',
        body: { cycleId: NIL, note: 'finalize' },
      },
      { method: 'POST', path: '/api/v1/pms/reopen', body: { cycleId: NIL, reason: 'reopening' } },
      { method: 'GET', path: `/api/v1/pms/${NIL}/state` },
      { method: 'GET', path: `/api/v1/pms/${NIL}/score` },
      { method: 'GET', path: `/api/v1/pms/${NIL}/pdf` },
      { method: 'GET', path: `/api/v1/pms/${NIL}/verify-signatures` },
      { method: 'GET', path: '/api/v1/pms/behavioural-dimensions' },
    ];
    await assertUnauthenticated(app, cases);
  });

  it('Mid-year routes reject unauthenticated', async () => {
    const cases: UnauthCase[] = [
      { method: 'POST', path: '/api/v1/mid-year/open', body: { cycleId: NIL } },
      {
        method: 'POST',
        path: '/api/v1/mid-year/save',
        body: { cycleId: NIL, updates: [{ kraId: NIL, resultAchieved: 'x', informalRating: 3 }] },
      },
      { method: 'POST', path: '/api/v1/mid-year/submit', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/mid-year/ack', body: { cycleId: NIL } },
      { method: 'GET', path: `/api/v1/mid-year/${NIL}` },
    ];
    await assertUnauthenticated(app, cases);
  });

  it('Notification routes reject unauthenticated', async () => {
    const cases: UnauthCase[] = [
      { method: 'GET', path: '/api/v1/notifications' },
      { method: 'GET', path: '/api/v1/notifications/unread-count' },
      { method: 'PATCH', path: `/api/v1/notifications/${NIL}/read` },
      { method: 'PATCH', path: '/api/v1/notifications/read-all' },
    ];
    await assertUnauthenticated(app, cases);
  });

  it('Cycle routes reject unauthenticated', async () => {
    const cases: UnauthCase[] = [
      { method: 'GET', path: '/api/v1/cycle/current' },
      { method: 'GET', path: `/api/v1/cycle/for-staff/${NIL}` },
      { method: 'GET', path: '/api/v1/cycle/list' },
      { method: 'POST', path: '/api/v1/cycle/open-pms-for-staff', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/cycle/open-mid-year-for-staff', body: { cycleId: NIL } },
      { method: 'POST', path: '/api/v1/cycle/open-pms-bulk', body: { scope: 'org' } },
      { method: 'POST', path: '/api/v1/cycle/open-mid-year-bulk', body: { scope: 'org' } },
      { method: 'GET', path: '/api/v1/cycle/departments' },
      { method: 'GET', path: '/api/v1/cycle/org-staff' },
    ];
    await assertUnauthenticated(app, cases);
  });
});

// ── 403 / 404 — Outsider tests ────────────────────────────────────────────────

describe('outsider (authenticated but unrelated) → 403/404 on staff-scoped endpoints', () => {
  it('PMS read endpoints deny outsider', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'GET',
        path: `/api/v1/pms/${pmsCycleId}/state`,
        outsiderCookie,
        expectedStatus: 403,
      },
      {
        method: 'GET',
        path: `/api/v1/pms/${pmsCycleId}/score`,
        outsiderCookie,
        expectedStatus: 403,
      },
      {
        method: 'GET',
        path: `/api/v1/pms/${pmsCycleId}/pdf`,
        outsiderCookie,
        // PDF route returns 403 if outsider, but 404 if no PDF — we expect 403 (scope gate first)
        expectedStatus: 403,
      },
      {
        method: 'GET',
        path: `/api/v1/pms/${pmsCycleId}/verify-signatures`,
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('PMS mutation endpoints deny outsider with service-layer ownership check (409 wrong_state or ownership error — confirms not 2xx)', async () => {
    // These endpoints all pass requireAuth (outsider is auth'd) but the service layer
    // enforces actor ownership (not_manager / not_owner / wrong_state).
    // The outsider will get a 409 (service rejection), NOT 2xx.
    // We just confirm they cannot succeed — the service enforces ownership via cycle.staffId checks.
    // We test that they are not accidentally open (any non-2xx is acceptable here, but they will be 409).

    // Note: kra-ratings requires body validation to pass first, so we send a valid-ish body.
    const nilKraId = '00000000-0000-0000-0000-000000000001';
    const nilDimCode = 'communication_skills'; // seeded in test DB

    const bodies = {
      kraRatings: {
        cycleId: pmsCycleId,
        ratings: [{ kraId: nilKraId, resultAchieved: 'x', finalRating: 3 }],
      },
      behavioural: {
        cycleId: pmsCycleId,
        ratings: [{ dimensionCode: nilDimCode, rating1to5: 3, rubricAnchorText: 'x' }],
      },
      contributions: { cycleId: pmsCycleId, contributions: [] },
      career: { cycleId: pmsCycleId, potentialWindow: 'now' },
      growth: { cycleId: pmsCycleId },
      comment: { cycleId: pmsCycleId, role: 'appraisee', body: 'x' },
      submitSelf: { cycleId: pmsCycleId },
      submitAppraiser: { cycleId: pmsCycleId },
      returnToAppraisee: { cycleId: pmsCycleId },
      submitNextLevel: { cycleId: pmsCycleId },
      returnToAppraiser: { cycleId: pmsCycleId },
      finalize: { cycleId: pmsCycleId },
      reopen: { cycleId: pmsCycleId, reason: 'test reopen' },
    };

    const nonSuccessStatuses = [400, 403, 404, 409, 422];

    for (const [name, body] of Object.entries(bodies)) {
      const paths: Record<string, string> = {
        kraRatings: '/api/v1/pms/kra-ratings',
        behavioural: '/api/v1/pms/behavioural',
        contributions: '/api/v1/pms/contributions',
        career: '/api/v1/pms/career',
        growth: '/api/v1/pms/growth',
        comment: '/api/v1/pms/comment',
        submitSelf: '/api/v1/pms/submit-self-review',
        submitAppraiser: '/api/v1/pms/submit-appraiser',
        returnToAppraisee: '/api/v1/pms/return-to-appraisee',
        submitNextLevel: '/api/v1/pms/submit-next-level',
        returnToAppraiser: '/api/v1/pms/return-to-appraiser',
        finalize: '/api/v1/pms/finalize',
        reopen: '/api/v1/pms/reopen',
      };

      const res = await app.request(paths[name]!, {
        method: 'POST',
        headers: { cookie: outsiderCookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const isNonSuccess = nonSuccessStatuses.includes(res.status) || res.status >= 400;
      if (!isNonSuccess) {
        throw new Error(`POST ${paths[name]} must not succeed for outsider (got ${res.status})`);
      }
    }
  });

  it('Mid-year read endpoint denies outsider (403)', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'GET',
        path: `/api/v1/mid-year/${midYearCycleId}`,
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('Mid-year open endpoint denies outsider (non-HRA → 403)', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'POST',
        path: '/api/v1/mid-year/open',
        body: { cycleId: midYearCycleId },
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('Notification endpoints return 404 for outsider trying another staff notification (hide existence)', async () => {
    // PATCH /:id/read returns 404 when the notification does not belong to the caller
    // (hide-existence pattern: outsider should not learn that the notification exists)
    const cases: ScopingCase[] = [
      {
        method: 'PATCH',
        path: `/api/v1/notifications/${notifId}/read`,
        outsiderCookie,
        // 404 chosen over 403: hides existence of the notification from the outsider
        expectedStatus: 404,
      },
    ];
    await assertScoped(app, cases);
  });

  it('Cycle for-staff endpoint denies outsider (403)', async () => {
    // GET /for-staff/:staffId — outsider may not look up another staff member's cycle
    // We need appraisee staffId — look it up via the cycleId we inserted
    const cycleRes = await db.execute(
      sql`select staff_id as "staffId" from performance_cycle where id = ${pmsCycleId}`,
    );
    const cycleRows = (
      Array.isArray(cycleRes) ? cycleRes : ((cycleRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ staffId: string }>;
    const appraiseeStaffId = cycleRows[0]!.staffId;

    const cases: ScopingCase[] = [
      {
        method: 'GET',
        path: `/api/v1/cycle/for-staff/${appraiseeStaffId}`,
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });

  it('Cycle HRA-only endpoints deny non-HRA outsider (403)', async () => {
    const cases: ScopingCase[] = [
      {
        method: 'POST',
        path: '/api/v1/cycle/open-pms-for-staff',
        body: { cycleId: pmsCycleId },
        outsiderCookie,
        expectedStatus: 403,
      },
      {
        method: 'POST',
        path: '/api/v1/cycle/open-mid-year-for-staff',
        body: { cycleId: midYearCycleId },
        outsiderCookie,
        expectedStatus: 403,
      },
      {
        method: 'POST',
        path: '/api/v1/cycle/open-pms-bulk',
        body: { scope: 'org' },
        outsiderCookie,
        expectedStatus: 403,
      },
      {
        method: 'POST',
        path: '/api/v1/cycle/open-mid-year-bulk',
        body: { scope: 'org' },
        outsiderCookie,
        expectedStatus: 403,
      },
      {
        method: 'GET',
        path: '/api/v1/cycle/departments',
        outsiderCookie,
        expectedStatus: 403,
      },
      {
        method: 'GET',
        path: '/api/v1/cycle/org-staff',
        outsiderCookie,
        expectedStatus: 403,
      },
    ];
    await assertScoped(app, cases);
  });
});
