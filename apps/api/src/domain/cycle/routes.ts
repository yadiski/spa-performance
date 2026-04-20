import { zValidator } from '@hono/zod-validator';
import { CycleState } from '@spa/shared';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Actor } from '../../auth/middleware';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { department, performanceCycle, staff } from '../../db/schema';
import { auditScopeViolation } from '../../rbac/audit-scope-violation';
import { staffReadScope } from '../../rbac/scope';
import { openMidYearWindow, openPmsWindow } from './windows';

export const cycleRoutes = new Hono();
cycleRoutes.use('*', requireAuth);

// ── helpers ────────────────────────────────────────────────────────────────────

/** State that allows open_pms transition (derived from state-machine.ts) */
const OPEN_PMS_ELIGIBLE = CycleState.MidYearDone;
/** State that allows open_mid_year transition (derived from state-machine.ts) */
const OPEN_MID_YEAR_ELIGIBLE = CycleState.KraApproved;

// ── GET /current ──────────────────────────────────────────────────────────────

cycleRoutes.get('/current', async (c) => {
  const actor = c.get('actor');
  if (!actor.staffId) return c.json({ cycle: null });
  const [row] = await db
    .select()
    .from(performanceCycle)
    .where(eq(performanceCycle.staffId, actor.staffId))
    .orderBy(sql`${performanceCycle.fy} desc`)
    .limit(1);
  return c.json({ cycle: row ?? null });
});

// ── GET /for-staff/:staffId ───────────────────────────────────────────────────

cycleRoutes.get('/for-staff/:staffId', async (c) => {
  const actor = c.get('actor');
  const staffId = c.req.param('staffId');

  // Ownership check: actor must be in scope for the requested staff member
  const scope = await staffReadScope(db, actor);
  const accessible = await db.execute(
    sql`select 1 from staff where id = ${staffId}::uuid and (${scope})`,
  );
  const accessRows = Array.isArray(accessible)
    ? accessible
    : ((accessible as { rows?: unknown[] }).rows ?? []);
  if (accessRows.length === 0) return c.json({ code: 'forbidden', message: 'forbidden' }, 403);

  const [row] = await db
    .select()
    .from(performanceCycle)
    .where(eq(performanceCycle.staffId, staffId))
    .orderBy(asc(performanceCycle.fy))
    .limit(1);
  if (!row) return c.json({ cycle: null }, 404);
  return c.json({ cycle: row });
});

// ── GET /list — list cycles (spec says GET /api/v1/cycle) ────────────────────
// Hono sub-router mounted at /api/v1/cycle: use /list path so the full URL
// becomes /api/v1/cycle/list — see notes in report about the path choice.

const listQuerySchema = z.object({
  state: z.nativeEnum(CycleState).optional(),
  fy: z.coerce.number().int().optional(),
  staffId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

cycleRoutes.get('/list', zValidator('query', listQuerySchema), async (c) => {
  const actor = c.get('actor');
  const q = c.req.valid('query');

  if (!actor.roles.includes('hra')) {
    // Non-HRA: return only their own cycle
    if (!actor.staffId) return c.json({ items: [], total: 0 });
    const rows = await db
      .select({
        id: performanceCycle.id,
        staffId: performanceCycle.staffId,
        staffName: staff.name,
        departmentId: staff.departmentId,
        departmentName: department.name,
        employeeNo: staff.employeeNo,
        fy: performanceCycle.fy,
        state: performanceCycle.state,
        midYearAt: performanceCycle.midYearAt,
        pmsFinalizedAt: performanceCycle.pmsFinalizedAt,
        updatedAt: performanceCycle.updatedAt,
      })
      .from(performanceCycle)
      .innerJoin(staff, eq(performanceCycle.staffId, staff.id))
      .innerJoin(department, eq(staff.departmentId, department.id))
      .where(eq(performanceCycle.staffId, actor.staffId));
    return c.json({ items: rows, total: rows.length });
  }

  // HRA: return all cycles in actor's org with optional filters
  if (!actor.staffId) return c.json({ items: [], total: 0 });

  const [actorStaff] = await db
    .select({ orgId: staff.orgId })
    .from(staff)
    .where(eq(staff.id, actor.staffId));
  if (!actorStaff) return c.json({ items: [], total: 0 });

  const orgId = actorStaff.orgId;

  const conditions = [eq(staff.orgId, orgId)];
  if (q.state) conditions.push(eq(performanceCycle.state, q.state));
  if (q.fy) conditions.push(eq(performanceCycle.fy, q.fy));
  if (q.staffId) conditions.push(eq(performanceCycle.staffId, q.staffId));
  if (q.departmentId) conditions.push(eq(staff.departmentId, q.departmentId));

  const where = and(...conditions);

  const [totalRow] = await db
    .select({ count: count() })
    .from(performanceCycle)
    .innerJoin(staff, eq(performanceCycle.staffId, staff.id))
    .where(where);

  const rows = await db
    .select({
      id: performanceCycle.id,
      staffId: performanceCycle.staffId,
      staffName: staff.name,
      departmentId: staff.departmentId,
      departmentName: department.name,
      employeeNo: staff.employeeNo,
      fy: performanceCycle.fy,
      state: performanceCycle.state,
      midYearAt: performanceCycle.midYearAt,
      pmsFinalizedAt: performanceCycle.pmsFinalizedAt,
      updatedAt: performanceCycle.updatedAt,
    })
    .from(performanceCycle)
    .innerJoin(staff, eq(performanceCycle.staffId, staff.id))
    .innerJoin(department, eq(staff.departmentId, department.id))
    .where(where)
    .limit(q.limit)
    .offset(q.offset);

  return c.json({ items: rows, total: totalRow?.count ?? 0 });
});

// ── POST /open-pms-for-staff ──────────────────────────────────────────────────

const singleCycleSchema = z.object({ cycleId: z.string().uuid() });

cycleRoutes.post('/open-pms-for-staff', zValidator('json', singleCycleSchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    await auditScopeViolation(db, {
      actor,
      targetType: 'cycle',
      targetId: c.req.valid('json').cycleId,
      reason: 'hra-only: open-pms-for-staff',
    });
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const { cycleId } = c.req.valid('json');
  const r = await openPmsWindow(db, actor, { cycleId });
  return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 409);
});

// ── POST /open-mid-year-for-staff ─────────────────────────────────────────────

cycleRoutes.post('/open-mid-year-for-staff', zValidator('json', singleCycleSchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    await auditScopeViolation(db, {
      actor,
      targetType: 'cycle',
      targetId: c.req.valid('json').cycleId,
      reason: 'hra-only: open-mid-year-for-staff',
    });
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const { cycleId } = c.req.valid('json');
  const r = await openMidYearWindow(db, actor, { cycleId });
  return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 409);
});

// ── Bulk schema ───────────────────────────────────────────────────────────────

const bulkScopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('org') }),
  z.object({ scope: z.literal('department'), departmentId: z.string().uuid() }),
  z.object({ scope: z.literal('staffIds'), staffIds: z.array(z.string().uuid()).min(1).max(500) }),
]);

type BulkResult = { opened: number; failed: Array<{ cycleId: string; error: string }> };

async function runBulk(
  actor: Actor,
  scope: z.infer<typeof bulkScopeSchema>,
  eligibleState: string,
  opener: typeof openPmsWindow,
): Promise<BulkResult> {
  if (!actor.staffId) return { opened: 0, failed: [] };

  const [actorStaff] = await db
    .select({ orgId: staff.orgId })
    .from(staff)
    .where(eq(staff.id, actor.staffId));
  if (!actorStaff) return { opened: 0, failed: [] };

  const orgId = actorStaff.orgId;

  // build eligibleState cast helper
  type EligibleState = 'mid_year_done' | 'kra_approved';
  const castState = eligibleState as EligibleState;

  let cycles: Array<{ id: string }>;

  if (scope.scope === 'org') {
    cycles = await db
      .select({ id: performanceCycle.id })
      .from(performanceCycle)
      .innerJoin(staff, eq(performanceCycle.staffId, staff.id))
      .where(and(eq(staff.orgId, orgId), eq(performanceCycle.state, castState)));
  } else if (scope.scope === 'department') {
    cycles = await db
      .select({ id: performanceCycle.id })
      .from(performanceCycle)
      .innerJoin(staff, eq(performanceCycle.staffId, staff.id))
      .where(
        and(
          eq(staff.orgId, orgId),
          eq(staff.departmentId, scope.departmentId),
          eq(performanceCycle.state, castState),
        ),
      );
  } else {
    // staffIds scope
    cycles = await db
      .select({ id: performanceCycle.id })
      .from(performanceCycle)
      .innerJoin(staff, eq(performanceCycle.staffId, staff.id))
      .where(
        and(
          eq(staff.orgId, orgId),
          inArray(performanceCycle.staffId, scope.staffIds),
          eq(performanceCycle.state, castState),
        ),
      );
  }

  let opened = 0;
  const failed: Array<{ cycleId: string; error: string }> = [];

  for (const cycle of cycles) {
    // Sequential await intentional — state machine has side effects that must not run in parallel
    // eslint-disable-next-line no-await-in-loop
    const r = await opener(db, actor, { cycleId: cycle.id });
    if (r.ok) {
      opened++;
    } else {
      failed.push({ cycleId: cycle.id, error: r.error });
    }
  }

  return { opened, failed };
}

// ── POST /open-pms-bulk ───────────────────────────────────────────────────────

cycleRoutes.post('/open-pms-bulk', zValidator('json', bulkScopeSchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    await auditScopeViolation(db, {
      actor,
      targetType: 'cycle',
      targetId: null,
      reason: 'hra-only: open-pms-bulk',
    });
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const scope = c.req.valid('json');
  const result = await runBulk(actor, scope, OPEN_PMS_ELIGIBLE, openPmsWindow);
  return c.json(result);
});

// ── POST /open-mid-year-bulk ──────────────────────────────────────────────────

cycleRoutes.post('/open-mid-year-bulk', zValidator('json', bulkScopeSchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    await auditScopeViolation(db, {
      actor,
      targetType: 'cycle',
      targetId: null,
      reason: 'hra-only: open-mid-year-bulk',
    });
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const scope = c.req.valid('json');
  const result = await runBulk(actor, scope, OPEN_MID_YEAR_ELIGIBLE, openMidYearWindow);
  return c.json(result);
});

// ── GET /departments — list departments for the actor's org (HRA only) ────────

cycleRoutes.get('/departments', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  if (!actor.staffId) return c.json({ items: [] });

  const [actorStaff] = await db
    .select({ orgId: staff.orgId })
    .from(staff)
    .where(eq(staff.id, actor.staffId));
  if (!actorStaff) return c.json({ items: [] });

  const depts = await db
    .select({ id: department.id, name: department.name, code: department.code })
    .from(department)
    .where(eq(department.orgId, actorStaff.orgId));

  return c.json({ items: depts });
});

// ── GET /org-staff — list staff for bulk picker (HRA only) ───────────────────

cycleRoutes.get('/org-staff', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  if (!actor.staffId) return c.json({ items: [] });

  const [actorStaff] = await db
    .select({ orgId: staff.orgId })
    .from(staff)
    .where(eq(staff.id, actor.staffId));
  if (!actorStaff) return c.json({ items: [] });

  const staffList = await db
    .select({
      id: staff.id,
      name: staff.name,
      employeeNo: staff.employeeNo,
      departmentId: staff.departmentId,
    })
    .from(staff)
    .where(eq(staff.orgId, actorStaff.orgId))
    .orderBy(sql`employee_no asc`);

  return c.json({ items: staffList });
});

// ── Cycle creation (HRA) ─────────────────────────────────────────────────────
// An HRA kicks off a cycle by creating the `performance_cycle` row in
// kra_drafting state for a staff member + FY. Without this entry point the
// platform has no way to move any staff into the workflow at all.

const createCycleBody = z.object({
  staffId: z.string().uuid(),
  fy: z.number().int().min(2020).max(2100),
});

cycleRoutes.post('/create', zValidator('json', createCycleBody), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    await auditScopeViolation(db, {
      actor,
      targetType: 'cycle',
      targetId: null,
      reason: 'hra-only: create cycle',
    });
    throw new HTTPException(403, { message: 'forbidden' });
  }

  const { staffId, fy } = c.req.valid('json');

  // Reject if a cycle already exists for (staffId, fy) — the PK on
  // (staffId, fy) would raise anyway but a cleaner error is nicer.
  const [existing] = await db
    .select({ id: performanceCycle.id })
    .from(performanceCycle)
    .where(and(eq(performanceCycle.staffId, staffId), eq(performanceCycle.fy, fy)))
    .limit(1);
  if (existing) {
    return c.json({ ok: false, error: 'cycle_already_exists', cycleId: existing.id }, 409);
  }

  const [row] = await db
    .insert(performanceCycle)
    .values({ staffId, fy, state: CycleState.KraDrafting })
    .returning({ id: performanceCycle.id });

  return c.json({ ok: true, cycleId: row?.id });
});

const createBulkBody = z.object({
  fy: z.number().int().min(2020).max(2100),
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('org') }),
    z.object({ type: z.literal('department'), departmentId: z.string().uuid() }),
    z.object({ type: z.literal('staffIds'), staffIds: z.array(z.string().uuid()).min(1).max(500) }),
  ]),
});

cycleRoutes.post('/create-bulk', zValidator('json', createBulkBody), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    await auditScopeViolation(db, {
      actor,
      targetType: 'cycle',
      targetId: null,
      reason: 'hra-only: create-bulk',
    });
    throw new HTTPException(403, { message: 'forbidden' });
  }

  if (!actor.staffId) return c.json({ created: 0, skipped: 0 });
  const [actorStaff] = await db
    .select({ orgId: staff.orgId })
    .from(staff)
    .where(eq(staff.id, actor.staffId));
  if (!actorStaff) return c.json({ created: 0, skipped: 0 });

  const { fy, scope } = c.req.valid('json');

  // Collect target staffIds based on scope.
  let targets: Array<{ id: string }>;
  if (scope.type === 'org') {
    targets = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.orgId, actorStaff.orgId), sql`terminated_at is null`));
  } else if (scope.type === 'department') {
    targets = await db
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.orgId, actorStaff.orgId),
          eq(staff.departmentId, scope.departmentId),
          sql`terminated_at is null`,
        ),
      );
  } else {
    targets = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.orgId, actorStaff.orgId), inArray(staff.id, scope.staffIds)));
  }

  if (targets.length === 0) return c.json({ created: 0, skipped: 0 });

  // Skip staff that already have a cycle for this FY. No unique index yet,
  // so do the dedupe with a query.
  const existingRows = await db
    .select({ staffId: performanceCycle.staffId })
    .from(performanceCycle)
    .where(
      and(
        inArray(
          performanceCycle.staffId,
          targets.map((t) => t.id),
        ),
        eq(performanceCycle.fy, fy),
      ),
    );
  const existingSet = new Set(existingRows.map((r) => r.staffId));
  const toCreate = targets.filter((t) => !existingSet.has(t.id));

  if (toCreate.length === 0) {
    return c.json({ created: 0, skipped: targets.length });
  }

  const inserted = await db
    .insert(performanceCycle)
    .values(
      toCreate.map((t) => ({
        staffId: t.id,
        fy,
        state: CycleState.KraDrafting,
      })),
    )
    .returning({ id: performanceCycle.id });

  return c.json({
    created: inserted.length,
    skipped: targets.length - inserted.length,
  });
});
