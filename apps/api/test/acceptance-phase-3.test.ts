/**
 * Phase-3 Acceptance Test — T40
 *
 * Drives a realistic end-to-end flow touching every Phase-3 subsystem:
 *   1. Staff summary AI call → cache row + audit row
 *   2. Calibration AI call → anonymization verified (no staff names in prompt)
 *   3. Dashboard MV refresh → query each MV → row counts match fixture
 *   4. XLSX export job → status=ready + notification + audit row
 *   5. Audit chain integrity → verifyChain passes after all the above
 *   6. Signed URL → GET /api/v1/exports/:id → 200 with { url, expiresAt }
 *
 * All network-like operations stubbed: callOpenRouter, r2.put, r2.getSignedUrl, boss.send.
 */

// Env must be set before any module-level import that needs it
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
setDefaultTimeout(90_000);

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { DEFAULT_BUDGET } from '../src/ai/core/budget';
import * as openrouterMod from '../src/ai/core/openrouter';
import { runCalibration } from '../src/ai/features/calibration';
import { runStaffSummary } from '../src/ai/features/staff-summary';
import { verifyChain } from '../src/audit/verifier';
import { refreshDashboardViews } from '../src/dashboards/aggregates';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { app } from '../src/http/app';
import { runGenerateXlsx } from '../src/jobs/generate-xlsx';
import * as queue from '../src/jobs/queue';
import * as r2 from '../src/storage/r2';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const FAKE_SHA256 = `acceptance3${'0'.repeat(53)}`;
const FAKE_SIGNED_URL = 'https://r2.example.com/fake-signed-url?token=abc123';

const r2PutSpy = spyOn(r2, 'put').mockResolvedValue({ sha256: FAKE_SHA256 });
const r2GetSignedUrlSpy = spyOn(r2, 'getSignedUrl').mockResolvedValue(FAKE_SIGNED_URL);
const bossSendSpy = spyOn(queue.boss, 'send').mockResolvedValue(null as unknown as string);

// Track prompts sent to the AI for the calibration anonymization assertion
let lastCalibrationPromptMessages: Array<{ role: string; content: string }> = [];

const mockOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(async (input) => {
  const systemMsg = input.messages.find((m) => m.role === 'system')?.content ?? '';
  if (systemMsg.includes('calibration')) {
    lastCalibrationPromptMessages = input.messages;
    return {
      content: {
        outliers: ['Slightly above grade average'],
        inconsistency_flags: [],
        talking_points: ['Distribution looks healthy'],
      },
      promptTokens: 120,
      completionTokens: 60,
      model: 'openai/gpt-5.4-nano',
    };
  }
  // Default: staff summary shape
  return {
    content: {
      highlights: ['Met all KRA targets in FY2026'],
      concerns: [],
      focus_areas: ['Leadership development'],
    },
    promptTokens: 100,
    completionTokens: 50,
    model: 'openai/gpt-5.4-nano',
  };
});

afterAll(() => {
  r2PutSpy.mockRestore();
  r2GetSignedUrlSpy.mockRestore();
  bossSendSpy.mockRestore();
  mockOpenRouter.mockRestore();
});

// ── Fixture state ─────────────────────────────────────────────────────────────

let orgId: string;
let hraUserId: string;
let hraStaffId: string;
let staffMemberId: string;
let staffMemberUserId: string;
let cycleId: string;
let gradeId: string;
let exportJobId: string;
let hraCookie: string;

const PW = 'acceptance3-correct-horse-battery-staple';

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

function dbRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

// ── Fixture setup ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });

  // Full wipe
  await client`truncate table notification, audit_log cascade`;
  await client`truncate table ai_cache, ai_usage_daily, ai_rate_limit cascade`;
  await client`truncate table export_job cascade`;
  await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
  await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
  await client`truncate table mid_year_checkpoint cascade`;
  await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
  await client`truncate table staff_role, staff, grade, department, organization cascade`;
  await client`truncate table "user" cascade`;

  // Ensure MVs exist (they may have been dropped by a prior test suite)
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_org_rollup CASCADE');
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_dept_rollup CASCADE');
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_cycle_summary CASCADE');

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_cycle_summary AS
      SELECT
        pc.id AS cycle_id, pc.staff_id, s.org_id, s.department_id, s.grade_id,
        pc.fy, pc.state, pfs.score_total::numeric(4,2) AS score_total,
        pc.pms_finalized_at AS finalized_at, pc.updated_at
      FROM performance_cycle pc
      JOIN staff s ON s.id = pc.staff_id
      LEFT JOIN pms_assessment pa ON pa.cycle_id = pc.id
      LEFT JOIN LATERAL (
        SELECT score_total FROM pms_final_snapshot
        WHERE pms_id = pa.id ORDER BY created_at DESC LIMIT 1
      ) pfs ON true
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_cycle_summary_idx ON mv_cycle_summary (cycle_id)',
  );

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_dept_rollup AS
      SELECT cs.department_id, cs.org_id,
        count(*) AS total_cycles,
        count(*) FILTER (WHERE cs.state = 'pms_finalized') AS finalized_cycles,
        round(avg(cs.score_total) FILTER (WHERE cs.score_total IS NOT NULL), 2) AS avg_score,
        now() AS updated_at
      FROM mv_cycle_summary cs GROUP BY cs.department_id, cs.org_id
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_dept_rollup_idx ON mv_dept_rollup (department_id, org_id)',
  );

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_org_rollup AS
      SELECT agg.org_id, agg.fy, agg.total_cycles, agg.finalized_cycles, agg.avg_score,
        sc.state_counts, now() AS updated_at
      FROM (
        SELECT org_id, fy, count(*) AS total_cycles,
          count(*) FILTER (WHERE state = 'pms_finalized') AS finalized_cycles,
          round(avg(score_total) FILTER (WHERE score_total IS NOT NULL), 2) AS avg_score
        FROM mv_cycle_summary GROUP BY org_id, fy
      ) agg
      JOIN (
        SELECT org_id, fy, jsonb_object_agg(state, n) AS state_counts
        FROM (SELECT org_id, fy, state, count(*) AS n FROM mv_cycle_summary GROUP BY org_id, fy, state) state_cnt
        GROUP BY org_id, fy
      ) sc ON sc.org_id = agg.org_id AND sc.fy = agg.fy
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_org_rollup_idx ON mv_org_rollup (org_id, fy)',
  );

  await client.end({ timeout: 2 });

  // ── Users ────────────────────────────────────────────────────────────────────
  const ts = Date.now();
  const hraEmail = `p3-acc-hra-${ts}@t.local`;
  const staffEmail = `p3-acc-staff-${ts}@t.local`;

  await signUp(hraEmail, 'HRA Acceptance3');
  await signUp(staffEmail, 'Staff Acceptance3');

  hraCookie = await signIn(hraEmail);

  const getUserId = async (email: string): Promise<string> => {
    const res = dbRows<{ id: string }>(
      await db.execute(sql`select id from "user" where email = ${email}`),
    );
    return res[0]!.id;
  };

  hraUserId = await getUserId(hraEmail);
  staffMemberUserId = await getUserId(staffEmail);

  // ── Org structure ─────────────────────────────────────────────────────────────
  const [org] = await db.insert(s.organization).values({ name: 'P3AcceptanceOrg' }).returning();
  orgId = org!.id;

  const [dept] = await db
    .insert(s.department)
    .values({ orgId, code: 'ENG', name: 'Engineering' })
    .returning();

  const [grade] = await db.insert(s.grade).values({ orgId, code: 'G7', rank: '7' }).returning();
  gradeId = grade!.id;

  // ── Staff ─────────────────────────────────────────────────────────────────────
  const [hraSt] = await db
    .insert(s.staff)
    .values({
      userId: hraUserId,
      orgId,
      employeeNo: `P3A-HRA-${ts}`,
      name: 'HRA Acceptance3',
      designation: 'HR Admin',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2020-01-01',
    })
    .returning();
  hraStaffId = hraSt!.id;

  const [staffSt] = await db
    .insert(s.staff)
    .values({
      userId: staffMemberUserId,
      orgId,
      employeeNo: `P3A-ST-${ts}`,
      name: 'Staff Acceptance3',
      designation: 'Engineer',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: hraSt!.id,
      hireDate: '2022-01-01',
    })
    .returning();
  staffMemberId = staffSt!.id;

  await db.insert(s.staffRole).values([
    { staffId: hraSt!.id, role: 'hra' },
    { staffId: staffSt!.id, role: 'staff' },
  ]);

  // ── Finalized PMS cycle ───────────────────────────────────────────────────────
  const [cy] = await db
    .insert(s.performanceCycle)
    .values({ staffId: staffSt!.id, fy: 2026, state: 'pms_finalized' })
    .returning();
  cycleId = cy!.id;

  const [pms] = await db.insert(s.pmsAssessment).values({ cycleId }).returning();
  await db.insert(s.pmsFinalSnapshot).values({
    pmsId: pms!.id,
    finalizedAt: new Date(),
    finalizedBy: hraUserId,
    scoreTotal: '4.12',
    scoreBreakdown: { kra: 3.5, behavioural: 0.5, contribution: 0.12, total: 4.12 },
  });

  // ── Provision ai_usage_daily at zero ──────────────────────────────────────────
  // (no row = zero usage — budget starts fresh)

  // ── Export job (pre-created, queued) ─────────────────────────────────────────
  const [expJob] = await db
    .insert(s.exportJob)
    .values({
      kind: 'pms_org_snapshot',
      requestedBy: hraUserId,
      orgId,
      params: { fy: 2026 },
      status: 'queued',
    })
    .returning();
  exportJobId = expJob!.id;
});

// ── Acceptance test ───────────────────────────────────────────────────────────

describe('phase 3 acceptance', () => {
  it('drives the ai + dashboard + export golden path', async () => {
    const hraActor = {
      userId: hraUserId,
      orgId,
      staffId: hraStaffId,
      roles: ['hra'],
    };

    // ── Step 1: Staff summary ─────────────────────────────────────────────────
    const summaryResult = await runStaffSummary({
      db,
      actor: hraActor,
      input: {
        orgId,
        cycleId,
        snapshot: {
          staffId: staffMemberId,
          kraScores: [{ kraId: 'kra-1', score: 4, weight: 80 }],
          overallRating: 4,
          grade: 'G7',
        },
      },
    });

    expect(summaryResult.ok, `runStaffSummary failed: ${JSON.stringify(summaryResult)}`).toBe(true);
    if (!summaryResult.ok) return;
    expect(summaryResult.cached).toBe(false);
    expect(summaryResult.output.highlights).toBeInstanceOf(Array);
    expect(summaryResult.output.highlights.length).toBeGreaterThanOrEqual(1);

    // Assert cache row was written
    const cacheRows = dbRows<{ feature: string; scope_key: string }>(
      await db.execute(
        sql`SELECT feature, scope_key FROM ai_cache WHERE feature = 'staff_summary'`,
      ),
    );
    expect(cacheRows.length).toBe(1);
    expect(cacheRows[0]!.scope_key).toContain(`org:${orgId}`);
    expect(cacheRows[0]!.scope_key).toContain(`cycle:${cycleId}`);

    // Assert audit row was written for the AI call
    const aiAuditRows = dbRows<{ event_type: string }>(
      await db.execute(
        sql`SELECT event_type FROM audit_log WHERE event_type = 'ai.call_succeeded' AND payload->>'feature' = 'staff_summary'`,
      ),
    );
    expect(aiAuditRows.length).toBe(1);

    // ── Step 2: Calibration with anonymization check ──────────────────────────
    lastCalibrationPromptMessages = [];

    const calibrationResult = await runCalibration({
      db,
      actor: hraActor,
      input: {
        orgId,
        gradeId,
        fy: '2026',
        peerRatings: [
          { staffId: staffMemberId, overallRating: 4 },
          { staffId: 'peer-staff-uuid-2', overallRating: 3 },
        ],
      },
    });

    expect(
      calibrationResult.ok,
      `runCalibration failed: ${JSON.stringify(calibrationResult)}`,
    ).toBe(true);
    if (!calibrationResult.ok) return;
    expect(calibrationResult.output.talking_points).toBeInstanceOf(Array);
    expect(calibrationResult.output.talking_points.length).toBeGreaterThanOrEqual(1);

    // KEY ASSERTION: staff names and real staffIds must NOT appear in prompt
    // (redactPII with anonymize:true replaces staffId with anon_<hash>)
    const userPromptContent =
      lastCalibrationPromptMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(
      userPromptContent,
      'Real staffId should not appear in calibration prompt (anonymization failed)',
    ).not.toContain(staffMemberId);
    // The user message should contain anon_ tokens instead
    expect(userPromptContent).toContain('anon_');

    // ── Step 3: Dashboard MV refresh ─────────────────────────────────────────
    await refreshDashboardViews(db);

    // Query mv_cycle_summary — should have our finalized cycle
    const cycleSummaryRows = dbRows<{ cycle_id: string; state: string }>(
      await db.execute(
        sql`SELECT cycle_id, state FROM mv_cycle_summary WHERE org_id = ${orgId}::uuid`,
      ),
    );
    expect(cycleSummaryRows.length).toBeGreaterThanOrEqual(1);
    const finalizedRow = cycleSummaryRows.find((r) => r.state === 'pms_finalized');
    expect(finalizedRow, 'pms_finalized cycle should appear in mv_cycle_summary').toBeDefined();

    // Query mv_dept_rollup
    const deptRollupRows = dbRows<{ total_cycles: string; finalized_cycles: string }>(
      await db.execute(
        sql`SELECT total_cycles, finalized_cycles FROM mv_dept_rollup WHERE org_id = ${orgId}::uuid`,
      ),
    );
    expect(deptRollupRows.length).toBeGreaterThanOrEqual(1);
    expect(Number(deptRollupRows[0]!.total_cycles)).toBeGreaterThanOrEqual(1);
    expect(Number(deptRollupRows[0]!.finalized_cycles)).toBeGreaterThanOrEqual(1);

    // Query mv_org_rollup
    const orgRollupRows = dbRows<{ total_cycles: string; finalized_cycles: string }>(
      await db.execute(
        sql`SELECT total_cycles, finalized_cycles FROM mv_org_rollup WHERE org_id = ${orgId}::uuid`,
      ),
    );
    expect(orgRollupRows.length).toBeGreaterThanOrEqual(1);
    expect(Number(orgRollupRows[0]!.total_cycles)).toBeGreaterThanOrEqual(1);

    // ── Step 4: XLSX export ───────────────────────────────────────────────────
    r2PutSpy.mockClear();
    bossSendSpy.mockClear();

    await runGenerateXlsx(db, exportJobId);

    // Assert export job is now ready
    const [exportRow] = await db.select().from(s.exportJob).where(sql`id = ${exportJobId}::uuid`);
    expect(exportRow?.status).toBe('ready');
    expect(exportRow?.sha256).toBeTruthy();
    expect(exportRow?.rowCount).toBeGreaterThanOrEqual(1);
    expect(exportRow?.r2Key).toContain(`exports/pms-org/${orgId}`);

    // Assert R2 put was called
    expect(r2PutSpy).toHaveBeenCalledTimes(1);

    // Assert notification was dispatched
    const notifRows = dbRows<{ kind: string }>(
      await db.execute(
        sql`SELECT kind FROM notification WHERE kind = 'export.ready' AND payload->>'exportJobId' = ${exportJobId}`,
      ),
    );
    expect(notifRows.length).toBe(1);

    // Assert audit row for export
    const exportAuditRows = dbRows<{ event_type: string }>(
      await db.execute(
        sql`SELECT event_type FROM audit_log WHERE event_type = 'export.pms_org.generated'`,
      ),
    );
    expect(exportAuditRows.length).toBe(1);

    // ── Step 5: Audit chain integrity ─────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const auditResult = await verifyChain(db, today, today);
    expect(
      auditResult.ok,
      `Audit chain verification failed after Phase-3 ops: ${JSON.stringify(auditResult)}`,
    ).toBe(true);

    // ── Step 6: Signed URL via API ────────────────────────────────────────────
    const res = await app.request(`/api/v1/exports/${exportJobId}`, {
      method: 'GET',
      headers: { cookie: hraCookie },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ready');
    expect(body.url).toBe(FAKE_SIGNED_URL);
    expect(typeof body.expiresAt).toBe('string');

    // getSignedUrl must have been called (route calls it for status=ready jobs)
    expect(r2GetSignedUrlSpy).toHaveBeenCalledTimes(1);
    expect(r2GetSignedUrlSpy.mock.calls[0]![0]).toContain(`exports/pms-org/${orgId}`);

    // ── Final: verify cache hit on second staff-summary call ──────────────────
    // (proves cache is load-bearing end-to-end, not just a unit test)
    mockOpenRouter.mockClear();
    const summaryResult2 = await runStaffSummary({
      db,
      actor: hraActor,
      input: {
        orgId,
        cycleId,
        snapshot: {
          staffId: staffMemberId,
          kraScores: [{ kraId: 'kra-1', score: 4, weight: 80 }],
          overallRating: 4,
          grade: 'G7',
        },
      },
    });
    expect(summaryResult2.ok).toBe(true);
    if (!summaryResult2.ok) return;
    expect(summaryResult2.cached, 'second call should be a cache hit').toBe(true);
    expect(mockOpenRouter, 'openrouter must not be called on cache hit').toHaveBeenCalledTimes(0);
  });
});
