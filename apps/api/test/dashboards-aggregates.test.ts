// Test for materialized view refresh (T18-T21)
// Must set env before any imports that read env at module level.
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { refreshDashboardViews } from '../src/dashboards/aggregates';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';

// ---------------------------------------------------------------------------
// Test-local cleanup
// ---------------------------------------------------------------------------
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  client = postgres(process.env.DATABASE_URL!, { max: 1 });
  // Clear data that might interfere
  await client`truncate table notification cascade`;
  await client`truncate table audit_log cascade`;
  await client`truncate table mid_year_checkpoint cascade`;
  await client`truncate table behavioural_rating, pms_kra_rating, staff_contribution,
    career_development, personal_growth, pms_comment, pms_final_snapshot,
    cycle_amendment, pms_assessment cascade`;
  await client`truncate table kra_progress_update, kra cascade`;
  await client`truncate table approval_transition, performance_cycle cascade`;
  await client`truncate table staff_role, staff, grade, department, organization cascade`;

  // Re-create materialized views with correct SQL in case a previous test run
  // applied an earlier (buggy) version. The DROP CASCADE + CREATE pattern is safe here.
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_org_rollup CASCADE');
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_dept_rollup CASCADE');
  await client.unsafe('DROP MATERIALIZED VIEW IF EXISTS mv_cycle_summary CASCADE');

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_cycle_summary AS
      SELECT
        pc.id            AS cycle_id,
        pc.staff_id,
        s.org_id,
        s.department_id,
        s.grade_id,
        pc.fy,
        pc.state,
        pfs.score_total::numeric(4,2) AS score_total,
        pc.pms_finalized_at            AS finalized_at,
        pc.updated_at
      FROM performance_cycle pc
      JOIN staff s ON s.id = pc.staff_id
      LEFT JOIN pms_assessment pa ON pa.cycle_id = pc.id
      LEFT JOIN LATERAL (
        SELECT score_total
        FROM pms_final_snapshot
        WHERE pms_id = pa.id
        ORDER BY created_at DESC
        LIMIT 1
      ) pfs ON true
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_cycle_summary_idx ON mv_cycle_summary (cycle_id)',
  );

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_dept_rollup AS
      SELECT
        cs.department_id,
        cs.org_id,
        count(*)                                    AS total_cycles,
        count(*) FILTER (WHERE cs.state = 'pms_finalized') AS finalized_cycles,
        round(avg(cs.score_total) FILTER (WHERE cs.score_total IS NOT NULL), 2) AS avg_score,
        now()                                       AS updated_at
      FROM mv_cycle_summary cs
      GROUP BY cs.department_id, cs.org_id
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_dept_rollup_idx ON mv_dept_rollup (department_id, org_id)',
  );

  await client.unsafe(`
    CREATE MATERIALIZED VIEW mv_org_rollup AS
      SELECT
        agg.org_id,
        agg.fy,
        agg.total_cycles,
        agg.finalized_cycles,
        agg.avg_score,
        sc.state_counts,
        now() AS updated_at
      FROM (
        SELECT
          org_id,
          fy,
          count(*)                                         AS total_cycles,
          count(*) FILTER (WHERE state = 'pms_finalized')  AS finalized_cycles,
          round(avg(score_total) FILTER (WHERE score_total IS NOT NULL), 2) AS avg_score
        FROM mv_cycle_summary
        GROUP BY org_id, fy
      ) agg
      JOIN (
        SELECT
          org_id,
          fy,
          jsonb_object_agg(state, n) AS state_counts
        FROM (
          SELECT org_id, fy, state, count(*) AS n
          FROM mv_cycle_summary
          GROUP BY org_id, fy, state
        ) state_cnt
        GROUP BY org_id, fy
      ) sc ON sc.org_id = agg.org_id AND sc.fy = agg.fy
  `);
  await client.unsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_org_rollup_idx ON mv_org_rollup (org_id, fy)',
  );
});

afterAll(async () => {
  await client?.end({ timeout: 2 });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('dashboard materialized views', () => {
  it('refreshes views and computes correct counts and avg scores', async () => {
    // ── seed org / dept / grade ────────────────────────────────────────────
    const [org] = await db.insert(s.organization).values({ name: 'DashOrg' }).returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, name: 'Engineering', code: 'ENG' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'G10', rank: '10' })
      .returning();

    // ── seed users and staff ───────────────────────────────────────────────
    const ts = Date.now();
    const [u1] = await db
      .insert(s.user)
      .values({ email: `dash-u1-${ts}@t.local`, name: 'U1' })
      .returning();
    const [u2] = await db
      .insert(s.user)
      .values({ email: `dash-u2-${ts}@t.local`, name: 'U2' })
      .returning();
    const [u3] = await db
      .insert(s.user)
      .values({ email: `dash-u3-${ts}@t.local`, name: 'U3' })
      .returning();

    const [st1] = await db
      .insert(s.staff)
      .values({
        userId: u1!.id,
        orgId: org!.id,
        employeeNo: `D-${ts}-1`,
        name: 'Staff 1',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    const [st2] = await db
      .insert(s.staff)
      .values({
        userId: u2!.id,
        orgId: org!.id,
        employeeNo: `D-${ts}-2`,
        name: 'Staff 2',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    const [st3] = await db
      .insert(s.staff)
      .values({
        userId: u3!.id,
        orgId: org!.id,
        employeeNo: `D-${ts}-3`,
        name: 'Staff 3',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();

    // ── seed cycles ────────────────────────────────────────────────────────
    // Cycle 1: finalized with score 3.50
    const [cy1] = await db
      .insert(s.performanceCycle)
      .values({ staffId: st1!.id, fy: 2026, state: 'pms_finalized' })
      .returning();

    // Cycle 2: finalized with score 4.20
    const [cy2] = await db
      .insert(s.performanceCycle)
      .values({ staffId: st2!.id, fy: 2026, state: 'pms_finalized' })
      .returning();

    // Cycle 3: in progress (pms_self_review), no score
    const [cy3] = await db
      .insert(s.performanceCycle)
      .values({ staffId: st3!.id, fy: 2026, state: 'pms_self_review' })
      .returning();

    // ── attach pms_final_snapshot for finalized cycles ─────────────────────
    const [pms1] = await db.insert(s.pmsAssessment).values({ cycleId: cy1!.id }).returning();
    await db.insert(s.pmsFinalSnapshot).values({
      pmsId: pms1!.id,
      finalizedAt: new Date(),
      finalizedBy: u1!.id,
      scoreTotal: '3.50',
      scoreBreakdown: { kra: 3.5, behavioural: 3.5, contribution: 3.5, total: 3.5 },
    });

    const [pms2] = await db.insert(s.pmsAssessment).values({ cycleId: cy2!.id }).returning();
    await db.insert(s.pmsFinalSnapshot).values({
      pmsId: pms2!.id,
      finalizedAt: new Date(),
      finalizedBy: u2!.id,
      scoreTotal: '4.20',
      scoreBreakdown: { kra: 4.2, behavioural: 4.2, contribution: 4.2, total: 4.2 },
    });

    // ── FIRST REFRESH ──────────────────────────────────────────────────────
    await refreshDashboardViews(db);

    // ── Assert mv_cycle_summary ────────────────────────────────────────────
    const cycleRows = rows<{
      cycle_id: string;
      state: string;
      score_total: string | null;
      org_id: string;
      department_id: string;
    }>(
      await db.execute(
        `SELECT cycle_id, state, score_total, org_id, department_id FROM mv_cycle_summary WHERE org_id = '${org!.id}'::uuid ORDER BY state`,
      ),
    );

    expect(cycleRows.length).toBe(3);
    const finalized = cycleRows.filter((r) => r.state === 'pms_finalized');
    expect(finalized.length).toBe(2);
    const scores = finalized.map((r) => Number(r.score_total)).sort();
    expect(scores[0]).toBeCloseTo(3.5, 1);
    expect(scores[1]).toBeCloseTo(4.2, 1);

    const inProgress = cycleRows.filter((r) => r.state === 'pms_self_review');
    expect(inProgress.length).toBe(1);
    expect(inProgress[0]?.score_total).toBeNull();

    // ── Assert mv_dept_rollup ──────────────────────────────────────────────
    const deptRows = rows<{
      total_cycles: string;
      finalized_cycles: string;
      avg_score: string | null;
    }>(
      await db.execute(
        `SELECT total_cycles, finalized_cycles, avg_score FROM mv_dept_rollup WHERE department_id = '${dept!.id}'::uuid`,
      ),
    );
    expect(deptRows.length).toBe(1);
    expect(Number(deptRows[0]!.total_cycles)).toBe(3);
    expect(Number(deptRows[0]!.finalized_cycles)).toBe(2);
    // avg of 3.50 and 4.20 = 3.85
    expect(Number(deptRows[0]!.avg_score)).toBeCloseTo(3.85, 1);

    // ── Assert mv_org_rollup ───────────────────────────────────────────────
    const orgRows = rows<{
      total_cycles: string;
      finalized_cycles: string;
      avg_score: string | null;
      state_counts: Record<string, number>;
    }>(
      await db.execute(
        `SELECT total_cycles, finalized_cycles, avg_score, state_counts FROM mv_org_rollup WHERE org_id = '${org!.id}'::uuid AND fy = 2026`,
      ),
    );
    expect(orgRows.length).toBe(1);
    expect(Number(orgRows[0]!.total_cycles)).toBe(3);
    expect(Number(orgRows[0]!.finalized_cycles)).toBe(2);
    expect(Number(orgRows[0]!.avg_score)).toBeCloseTo(3.85, 1);

    const sc = orgRows[0]!.state_counts as Record<string, number>;
    expect(Number(sc.pms_finalized)).toBe(2);
    expect(Number(sc.pms_self_review)).toBe(1);

    // ── Add a new cycle and verify refresh picks it up ─────────────────────
    // Add a 4th cycle (another finalized) and re-run refresh
    const [u4] = await db
      .insert(s.user)
      .values({ email: `dash-u4-${ts}@t.local`, name: 'U4' })
      .returning();
    const [st4] = await db
      .insert(s.staff)
      .values({
        userId: u4!.id,
        orgId: org!.id,
        employeeNo: `D-${ts}-4`,
        name: 'Staff 4',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    const [cy4] = await db
      .insert(s.performanceCycle)
      .values({ staffId: st4!.id, fy: 2026, state: 'pms_finalized' })
      .returning();
    const [pms4] = await db.insert(s.pmsAssessment).values({ cycleId: cy4!.id }).returning();
    await db.insert(s.pmsFinalSnapshot).values({
      pmsId: pms4!.id,
      finalizedAt: new Date(),
      finalizedBy: u4!.id,
      scoreTotal: '5.00',
      scoreBreakdown: { kra: 5.0, behavioural: 5.0, contribution: 5.0, total: 5.0 },
    });

    // ── SECOND REFRESH ─────────────────────────────────────────────────────
    await refreshDashboardViews(db);

    const orgRows2 = rows<{ total_cycles: string; finalized_cycles: string }>(
      await db.execute(
        `SELECT total_cycles, finalized_cycles FROM mv_org_rollup WHERE org_id = '${org!.id}'::uuid AND fy = 2026`,
      ),
    );
    expect(Number(orgRows2[0]!.total_cycles)).toBe(4);
    expect(Number(orgRows2[0]!.finalized_cycles)).toBe(3);
  });
});
