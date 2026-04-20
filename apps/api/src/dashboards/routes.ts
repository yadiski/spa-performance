import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../auth/middleware';
import { db } from '../db/client';
import { department, performanceCycle, staff } from '../db/schema';
import { directReports } from '../rbac/hierarchy';

export const dashboardRoutes = new Hono();
dashboardRoutes.use('*', requireAuth);

// ── helpers ───────────────────────────────────────────────────────────────────

/** Extract rows from a drizzle raw execute result (array or {rows:[]}). */
function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r.rows ?? [];
}

/**
 * Build a sql fragment for IN (uuid, uuid, ...) to avoid the malformed array literal issue
 * when passing uuid arrays to ANY().
 */
function uuidInList(ids: string[]) {
  if (ids.length === 0) return sql`false`;
  const parts = ids.map((id) => sql`${id}::uuid`);
  return sql`(${sql.join(parts, sql`, `)})`;
}

// ── GET /me — actor's own cycles with trajectory data ────────────────────────

dashboardRoutes.get('/me', async (c) => {
  const actor = c.get('actor');
  if (!actor.staffId) return c.json({ cycles: [] });

  // Fetch all cycles for this staff member
  const cycles = await db
    .select({
      id: performanceCycle.id,
      fy: performanceCycle.fy,
      state: performanceCycle.state,
    })
    .from(performanceCycle)
    .where(eq(performanceCycle.staffId, actor.staffId))
    .orderBy(performanceCycle.fy);

  if (cycles.length === 0) return c.json({ cycles: [] });

  const cycleIds = cycles.map((cyc) => cyc.id);

  // Fetch latest score for each cycle from mv_cycle_summary (if populated)
  const scoreRows = rows<{ cycle_id: string; score_total: string | null }>(
    await db.execute(
      sql`SELECT cycle_id, score_total FROM mv_cycle_summary WHERE cycle_id IN ${uuidInList(cycleIds)}`,
    ),
  );
  const scoreMap = new Map(scoreRows.map((r) => [r.cycle_id, r.score_total]));

  // Trajectory data: avg mid-year rating and avg latest rating per cycle
  const trajectoryRows = rows<{
    cycle_id: string;
    by_role: string;
    avg_rating: string;
  }>(
    await db.execute(sql`
      SELECT
        k.cycle_id,
        kpu.by_role,
        avg(kpu.rating_1_to_5)::numeric(4,2) AS avg_rating
      FROM kra_progress_update kpu
      JOIN kra k ON k.id = kpu.kra_id
      WHERE k.cycle_id IN ${uuidInList(cycleIds)}
      GROUP BY k.cycle_id, kpu.by_role
    `),
  );

  // Group trajectory data by cycle_id and by_role
  const trajMap = new Map<string, { mid_year?: number; latest?: number }>();
  for (const row of trajectoryRows) {
    const entry = trajMap.get(row.cycle_id) ?? {};
    if (row.by_role === 'mid_year') {
      entry.mid_year = Number(row.avg_rating);
    } else {
      entry.latest = Number(row.avg_rating);
    }
    trajMap.set(row.cycle_id, entry);
  }

  const result = cycles.map((cyc) => {
    const traj = trajMap.get(cyc.id) ?? {};
    const rawScore = scoreMap.get(cyc.id);
    return {
      id: cyc.id,
      fy: cyc.fy,
      state: cyc.state,
      scoreTotal: rawScore != null ? Number(rawScore) : null,
      trajectoryJune: traj.mid_year ?? null,
      trajectoryNow: traj.latest ?? null,
    };
  });

  return c.json({ cycles: result });
});

// ── GET /team — direct-report summary for the actor ──────────────────────────

dashboardRoutes.get('/team', async (c) => {
  const actor = c.get('actor');
  if (!actor.staffId)
    return c.json({
      directReports: [],
      pendingActions: [],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });

  const reports = await directReports(db, actor.staffId);
  if (reports.length === 0) {
    return c.json({
      directReports: [],
      pendingActions: [],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
  }

  const reportIds = reports.map((r) => r.id);

  // Fetch cycle data for all direct reports from mv_cycle_summary
  const cycleRows = rows<{
    cycle_id: string;
    staff_id: string;
    state: string;
    score_total: string | null;
  }>(
    await db.execute(
      sql`SELECT cycle_id, staff_id, state, score_total FROM mv_cycle_summary WHERE staff_id IN ${uuidInList(reportIds)}`,
    ),
  );

  const cycleIdList = cycleRows.map((r) => r.cycle_id);

  const trajMap = new Map<string, { mid_year?: number; latest?: number }>();

  if (cycleIdList.length > 0) {
    const trajRows = rows<{
      cycle_id: string;
      by_role: string;
      avg_rating: string;
    }>(
      await db.execute(sql`
        SELECT
          k.cycle_id,
          kpu.by_role,
          avg(kpu.rating_1_to_5)::numeric(4,2) AS avg_rating
        FROM kra_progress_update kpu
        JOIN kra k ON k.id = kpu.kra_id
        WHERE k.cycle_id IN ${uuidInList(cycleIdList)}
        GROUP BY k.cycle_id, kpu.by_role
      `),
    );

    for (const row of trajRows) {
      const entry = trajMap.get(row.cycle_id) ?? {};
      if (row.by_role === 'mid_year') {
        entry.mid_year = Number(row.avg_rating);
      } else {
        entry.latest = Number(row.avg_rating);
      }
      trajMap.set(row.cycle_id, entry);
    }
  }

  // Build per-staff response — keep most-recent cycle per staff
  const cycleByStaff = new Map<string, (typeof cycleRows)[0]>();
  for (const row of cycleRows) {
    if (!cycleByStaff.has(row.staff_id)) cycleByStaff.set(row.staff_id, row);
  }

  const directReportItems = reports.map((r) => {
    const cyc = cycleByStaff.get(r.id);
    const traj = cyc ? (trajMap.get(cyc.cycle_id) ?? {}) : {};
    return {
      staffId: r.id,
      name: r.name,
      employeeNo: r.employeeNo,
      currentCycleState: cyc?.state ?? null,
      scoreTotal: cyc?.score_total != null ? Number(cyc.score_total) : null,
      trajectoryJune: traj.mid_year ?? null,
      trajectoryNow: traj.latest ?? null,
    };
  });

  // Pending actions: cycles where appraiser must act
  const pendingStates = ['pms_awaiting_appraiser'];
  const pendingItems = directReportItems
    .filter((r) => r.currentCycleState && pendingStates.includes(r.currentCycleState))
    .map((r) => {
      const cyc = cycleByStaff.get(r.staffId);
      return {
        cycleId: cyc?.cycle_id ?? '',
        staffName: r.name,
        action: 'Appraiser review required',
      };
    });

  const total = directReportItems.length;
  const completed = directReportItems.filter((r) => r.currentCycleState === 'pms_finalized').length;
  const inProgress = directReportItems.filter(
    (r) => r.currentCycleState && r.currentCycleState !== 'pms_finalized',
  ).length;

  return c.json({
    directReports: directReportItems,
    pendingActions: pendingItems,
    stats: { total, completed, inProgress },
  });
});

// ── GET /dept — department-scoped dashboard (department_head or HRA) ──────────

dashboardRoutes.get('/dept', async (c) => {
  const actor = c.get('actor');
  const isDeptHead = actor.roles.includes('department_head');
  const isHra = actor.roles.includes('hra') || actor.roles.includes('hr_manager');

  if (!isDeptHead && !isHra) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  if (!actor.staffId) {
    throw new HTTPException(403, { message: 'forbidden' });
  }

  // Get actor's department
  const [actorStaff] = await db
    .select({ departmentId: staff.departmentId, orgId: staff.orgId })
    .from(staff)
    .where(eq(staff.id, actor.staffId));

  if (!actorStaff) throw new HTTPException(403, { message: 'forbidden' });

  const { departmentId, orgId } = actorStaff;

  // Department info
  const [deptInfo] = await db
    .select({ id: department.id, name: department.name })
    .from(department)
    .where(eq(department.id, departmentId));

  // Rollup from mv_dept_rollup
  const rollupRows = rows<{
    total_cycles: string;
    finalized_cycles: string;
    avg_score: string | null;
  }>(
    await db.execute(
      sql`SELECT total_cycles, finalized_cycles, avg_score FROM mv_dept_rollup WHERE department_id = ${departmentId}::uuid AND org_id = ${orgId}::uuid`,
    ),
  );

  const rollup = rollupRows[0]
    ? {
        totalCycles: Number(rollupRows[0].total_cycles),
        finalizedCycles: Number(rollupRows[0].finalized_cycles),
        avgScore: rollupRows[0].avg_score != null ? Number(rollupRows[0].avg_score) : null,
      }
    : { totalCycles: 0, finalizedCycles: 0, avgScore: null };

  // Score distribution from mv_cycle_summary
  // Note: PostgreSQL doesn't allow referencing column aliases in HAVING, so use a subquery
  const distRows = rows<{ bucket: string; count: string }>(
    await db.execute(sql`
      SELECT bucket, count(*)::int AS count FROM (
        SELECT
          CASE
            WHEN score_total >= 1 AND score_total < 2 THEN '1-2'
            WHEN score_total >= 2 AND score_total < 3 THEN '2-3'
            WHEN score_total >= 3 AND score_total < 4 THEN '3-4'
            WHEN score_total >= 4 AND score_total <= 5 THEN '4-5'
          END AS bucket
        FROM mv_cycle_summary
        WHERE department_id = ${departmentId}::uuid
          AND score_total IS NOT NULL
      ) sub
      WHERE bucket IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `),
  );

  const distribution = distRows.map((r) => ({ bucket: r.bucket, count: Number(r.count) }));

  // Cycles in this department
  const cyclesRows = rows<{
    cycle_id: string;
    staff_id: string;
    state: string;
    score_total: string | null;
  }>(
    await db.execute(
      sql`SELECT cycle_id, staff_id, state, score_total FROM mv_cycle_summary WHERE department_id = ${departmentId}::uuid ORDER BY state`,
    ),
  );

  // Fetch staff names
  const staffIds = [...new Set(cyclesRows.map((r) => r.staff_id))];
  let nameMap = new Map<string, string>();
  if (staffIds.length > 0) {
    const nameRows = rows<{ id: string; name: string }>(
      await db.execute(sql`SELECT id, name FROM staff WHERE id IN ${uuidInList(staffIds)}`),
    );
    nameMap = new Map(nameRows.map((r) => [r.id, r.name]));
  }

  const cycles = cyclesRows.map((r) => ({
    cycleId: r.cycle_id,
    staffName: nameMap.get(r.staff_id) ?? '',
    state: r.state,
    scoreTotal: r.score_total != null ? Number(r.score_total) : null,
  }));

  return c.json({
    department: deptInfo ?? { id: departmentId, name: '' },
    rollup,
    distribution,
    cycles,
  });
});

// ── GET /hr — org-wide dashboard (HRA only) ───────────────────────────────────

dashboardRoutes.get('/hr', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('hr_manager')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  if (!actor.staffId) throw new HTTPException(403, { message: 'forbidden' });

  // Get actor's org
  const [actorStaff] = await db
    .select({ orgId: staff.orgId })
    .from(staff)
    .where(eq(staff.id, actor.staffId));
  if (!actorStaff) throw new HTTPException(403, { message: 'forbidden' });

  const { orgId } = actorStaff;
  const currentFy = new Date().getFullYear();

  // Org rollup from mv_org_rollup
  const orgRollupRows = rows<{
    total_cycles: string;
    finalized_cycles: string;
    avg_score: string | null;
    state_counts: Record<string, number>;
  }>(
    await db.execute(
      sql`SELECT total_cycles, finalized_cycles, avg_score, state_counts FROM mv_org_rollup WHERE org_id = ${orgId}::uuid AND fy = ${currentFy}`,
    ),
  );

  const orgRow = orgRollupRows[0];
  const rollup = orgRow
    ? {
        totalCycles: Number(orgRow.total_cycles),
        finalizedCycles: Number(orgRow.finalized_cycles),
        avgScore: orgRow.avg_score != null ? Number(orgRow.avg_score) : null,
      }
    : { totalCycles: 0, finalizedCycles: 0, avgScore: null };

  const stateCounts: Record<string, number> = orgRow?.state_counts ?? {};

  // Per-department breakdown from mv_dept_rollup + department names
  const deptRollupRows = rows<{
    department_id: string;
    total_cycles: string;
    finalized_cycles: string;
    avg_score: string | null;
  }>(
    await db.execute(
      sql`SELECT department_id, total_cycles, finalized_cycles, avg_score FROM mv_dept_rollup WHERE org_id = ${orgId}::uuid`,
    ),
  );

  const deptIds = deptRollupRows.map((r) => r.department_id);
  let deptNameMap = new Map<string, string>();
  if (deptIds.length > 0) {
    const deptNameRows = rows<{ id: string; name: string }>(
      await db.execute(sql`SELECT id, name FROM department WHERE id IN ${uuidInList(deptIds)}`),
    );
    deptNameMap = new Map(deptNameRows.map((r) => [r.id, r.name]));
  }

  const departments = deptRollupRows.map((r) => ({
    id: r.department_id,
    name: deptNameMap.get(r.department_id) ?? '',
    totalCycles: Number(r.total_cycles),
    finalizedCycles: Number(r.finalized_cycles),
    avgScore: r.avg_score != null ? Number(r.avg_score) : null,
  }));

  return c.json({ rollup, stateCounts, departments });
});
