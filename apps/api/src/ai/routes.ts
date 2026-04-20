import { zValidator } from '@hono/zod-validator';
import { and, count, eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { db } from '../db/client';
import { aiUsageDaily, grade, kra, performanceCycle, staff } from '../db/schema';
import { staffReadScope } from '../rbac/scope';
import { DEFAULT_BUDGET } from './core/budget';
import {
  runCalibration,
  runDevRecommendations,
  runKraQuality,
  runMidYearNudges,
  runStaffSummary,
} from './index';
import type { DispatchResult } from './index';

export const aiRoutes = new Hono();
aiRoutes.use('*', requireAuth);

// ── Error translation helper ─────────────────────────────────────────────────

type ErrorResult = Extract<DispatchResult<unknown>, { ok: false }>;

// biome-ignore lint/suspicious/noExplicitAny: generic hono context
function errorResponse(c: Context<any>, result: ErrorResult) {
  switch (result.error) {
    case 'budget_exhausted':
      return c.json({ code: 'ai_budget_exhausted' }, 409);
    case 'schema_failed':
      return c.json({ code: 'ai_schema_failed' }, 502);
    case 'openrouter_error':
      return c.json({ code: 'ai_upstream_error' }, 502);
    case 'rate_limited':
      return c.json({ code: 'ai_rate_limited' }, 429);
    default:
      return c.json({ code: 'ai_error' }, 500);
  }
}

// ── Helper: load actor's orgId from staff table ──────────────────────────────

async function resolveOrgId(staffId: string | null): Promise<string | null> {
  if (!staffId) return null;
  const [row] = await db.select({ orgId: staff.orgId }).from(staff).where(eq(staff.id, staffId));
  return row?.orgId ?? null;
}

// ── Helper: cycle scope check ─────────────────────────────────────────────────

async function checkCycleAccess(
  cycleId: string,
  actor: { staffId: string | null; roles: string[] },
): Promise<{ allowed: boolean; cycle: { staffId: string; fy: number; state: string } | null }> {
  const [cycle] = await db.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
  if (!cycle) return { allowed: false, cycle: null };

  const scope = await staffReadScope(db, actor as Parameters<typeof staffReadScope>[1]);
  const accessible = await db.execute(
    sql`select 1 from staff where id = ${cycle.staffId} and (${scope})`,
  );
  const rows = Array.isArray(accessible)
    ? accessible
    : ((accessible as { rows?: unknown[] }).rows ?? []);
  return { allowed: rows.length > 0, cycle };
}

// ── 1. POST /api/v1/ai/staff-summary ────────────────────────────────────────

aiRoutes.post(
  '/staff-summary',
  zValidator('json', z.object({ cycleId: z.string().uuid() })),
  async (c) => {
    const actor = c.get('actor');
    const { cycleId } = c.req.valid('json');

    const { allowed, cycle } = await checkCycleAccess(cycleId, actor);
    if (!allowed || !cycle) {
      return cycle === null
        ? c.json({ code: 'cycle_not_found' }, 404)
        : c.json({ code: 'forbidden' }, 403);
    }

    const orgId = await resolveOrgId(actor.staffId);
    if (!orgId) return c.json({ code: 'forbidden' }, 403);

    const result = await runStaffSummary({
      db,
      actor: {
        userId: actor.userId,
        orgId,
        staffId: actor.staffId,
        roles: actor.roles as string[],
      },
      input: {
        orgId,
        cycleId,
        snapshot: { staffId: cycle.staffId },
      },
    });

    if (!result.ok) return errorResponse(c, result);
    return c.json({ ok: true, output: result.output });
  },
);

// ── 2. POST /api/v1/ai/kra-quality ──────────────────────────────────────────

aiRoutes.post(
  '/kra-quality',
  zValidator('json', z.object({ kraId: z.string().uuid() })),
  async (c) => {
    const actor = c.get('actor');
    const { kraId } = c.req.valid('json');

    // Load KRA → cycle → scope check
    const [kraRow] = await db.select().from(kra).where(eq(kra.id, kraId));
    if (!kraRow) return c.json({ code: 'kra_not_found' }, 404);

    const { allowed } = await checkCycleAccess(kraRow.cycleId, actor);
    if (!allowed) return c.json({ code: 'forbidden' }, 403);

    const orgId = await resolveOrgId(actor.staffId);
    if (!orgId) return c.json({ code: 'forbidden' }, 403);

    const result = await runKraQuality({
      db,
      actor: {
        userId: actor.userId,
        orgId,
        staffId: actor.staffId,
        roles: actor.roles as string[],
      },
      input: {
        orgId,
        kraId,
        kra: {
          perspective: kraRow.perspective,
          description: kraRow.description,
          weightPct: kraRow.weightPct,
          measurement: kraRow.measurement,
          target: kraRow.target,
          rubric1to5: (kraRow.rubric1to5 as string[]) ?? [],
        },
      },
    });

    if (!result.ok) return errorResponse(c, result);
    return c.json({ ok: true, output: result.output });
  },
);

// ── 3. POST /api/v1/ai/dev-recommendations ──────────────────────────────────

aiRoutes.post(
  '/dev-recommendations',
  zValidator('json', z.object({ cycleId: z.string().uuid() })),
  async (c) => {
    const actor = c.get('actor');
    const { cycleId } = c.req.valid('json');

    const { allowed, cycle } = await checkCycleAccess(cycleId, actor);
    if (!allowed || !cycle) {
      return cycle === null
        ? c.json({ code: 'cycle_not_found' }, 404)
        : c.json({ code: 'forbidden' }, 403);
    }

    const orgId = await resolveOrgId(actor.staffId);
    if (!orgId) return c.json({ code: 'forbidden' }, 403);

    // Load staff grade for context
    const [staffRow] = await db
      .select({ gradeId: staff.gradeId })
      .from(staff)
      .where(eq(staff.id, cycle.staffId));
    const gradeCode = staffRow?.gradeId ?? 'unknown';

    const result = await runDevRecommendations({
      db,
      actor: {
        userId: actor.userId,
        orgId,
        staffId: actor.staffId,
        roles: actor.roles as string[],
      },
      input: {
        orgId,
        cycleId,
        careerSummary: '',
        growthSummary: '',
        behaviouralSummary: '',
        grade: gradeCode,
      },
    });

    if (!result.ok) return errorResponse(c, result);
    return c.json({ ok: true, output: result.output });
  },
);

// ── 4. POST /api/v1/ai/calibration ──────────────────────────────────────────

aiRoutes.post(
  '/calibration',
  zValidator('json', z.object({ gradeId: z.string().uuid(), fy: z.number().int() })),
  async (c) => {
    const actor = c.get('actor');

    if (!actor.roles.includes('hra')) {
      return c.json({ code: 'forbidden' }, 403);
    }

    const { gradeId, fy } = c.req.valid('json');

    const orgId = await resolveOrgId(actor.staffId);
    if (!orgId) return c.json({ code: 'forbidden' }, 403);

    // Gather finalized cycles at this grade + fy
    const cycles = await db
      .select({
        staffId: performanceCycle.staffId,
        cycleId: performanceCycle.id,
      })
      .from(performanceCycle)
      .innerJoin(staff, eq(performanceCycle.staffId, staff.id))
      .where(
        and(
          eq(staff.orgId, orgId),
          eq(staff.gradeId, gradeId),
          eq(performanceCycle.fy, fy),
          eq(performanceCycle.state, 'pms_finalized'),
        ),
      );

    const peerRatings = cycles.map((row) => ({
      staffId: row.staffId,
      overallRating: 3, // placeholder — real impl would join pms_final_snapshot
    }));

    const result = await runCalibration({
      db,
      actor: {
        userId: actor.userId,
        orgId,
        staffId: actor.staffId,
        roles: actor.roles as string[],
      },
      input: {
        orgId,
        gradeId,
        fy: String(fy),
        peerRatings,
      },
    });

    if (!result.ok) return errorResponse(c, result);
    return c.json({ ok: true, output: result.output });
  },
);

// ── 5. POST /api/v1/ai/mid-year-nudges ──────────────────────────────────────

aiRoutes.post(
  '/mid-year-nudges',
  zValidator('json', z.object({ cycleId: z.string().uuid() })),
  async (c) => {
    const actor = c.get('actor');
    const { cycleId } = c.req.valid('json');

    const { allowed, cycle } = await checkCycleAccess(cycleId, actor);
    if (!allowed || !cycle) {
      return cycle === null
        ? c.json({ code: 'cycle_not_found' }, 404)
        : c.json({ code: 'forbidden' }, 403);
    }

    const orgId = await resolveOrgId(actor.staffId);
    if (!orgId) return c.json({ code: 'forbidden' }, 403);

    const result = await runMidYearNudges({
      db,
      actor: {
        userId: actor.userId,
        orgId,
        staffId: actor.staffId,
        roles: actor.roles as string[],
      },
      input: {
        orgId,
        cycleId,
        kraProgress: [],
        remainingDays: 90,
      },
    });

    if (!result.ok) return errorResponse(c, result);
    return c.json({ ok: true, output: result.output });
  },
);

// ── 6. GET /api/v1/ai/usage-today ────────────────────────────────────────────

aiRoutes.get('/usage-today', async (c) => {
  const actor = c.get('actor');

  if (!actor.roles.includes('hra')) {
    return c.json({ code: 'forbidden' }, 403);
  }

  const orgId = await resolveOrgId(actor.staffId);
  if (!orgId) return c.json({ code: 'forbidden' }, 403);

  const today = new Date().toISOString().slice(0, 10);

  const [usage] = await db
    .select()
    .from(aiUsageDaily)
    .where(and(eq(aiUsageDaily.orgId, orgId), eq(aiUsageDaily.date, today)));

  const promptTokens = Number(usage?.promptTokens ?? 0);
  const completionTokens = Number(usage?.completionTokens ?? 0);
  const requests = Number(usage?.requests ?? 0);
  const dailyCap = DEFAULT_BUDGET.dailyOrgTokenCap;
  const totalTokens = promptTokens + completionTokens;
  const usagePct = Math.min(100, Math.round((totalTokens / dailyCap) * 100));

  return c.json({ promptTokens, completionTokens, requests, dailyCap, usagePct });
});

// ── 7. GET /api/v1/ai/calibration-cohorts ────────────────────────────────────

aiRoutes.get('/calibration-cohorts', async (c) => {
  const actor = c.get('actor');

  if (!actor.roles.includes('hra')) {
    return c.json({ code: 'forbidden' }, 403);
  }

  const fyParam = c.req.query('fy');
  const fy = fyParam ? Number(fyParam) : new Date().getFullYear();

  const orgId = await resolveOrgId(actor.staffId);
  if (!orgId) return c.json({ code: 'forbidden' }, 403);

  const rows = await db
    .select({
      gradeId: grade.id,
      gradeCode: grade.code,
      gradeRank: grade.rank,
      fy: performanceCycle.fy,
      cycleCount: count(performanceCycle.id),
    })
    .from(performanceCycle)
    .innerJoin(staff, eq(performanceCycle.staffId, staff.id))
    .innerJoin(grade, eq(staff.gradeId, grade.id))
    .where(
      and(
        eq(staff.orgId, orgId),
        eq(performanceCycle.fy, fy),
        eq(performanceCycle.state, 'pms_finalized'),
      ),
    )
    .groupBy(grade.id, grade.code, grade.rank, performanceCycle.fy);

  return c.json({
    items: rows.map((r) => ({
      gradeId: r.gradeId,
      gradeCode: r.gradeCode,
      gradeRank: r.gradeRank,
      fy: r.fy,
      cycleCount: Number(r.cycleCount),
      avgScore: null, // Would require joining pms_final_snapshot
    })),
  });
});
