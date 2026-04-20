import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { applyBatch, revertBatch, stageBatch } from './bulk-import';
import { importStaffCsv } from './import';

export const staffRoutes = new Hono();
staffRoutes.use('*', requireAuth);

// ── Legacy single-shot import ─────────────────────────────────────────────
staffRoutes.post('/import', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const csv = await c.req.text();
  const orgId = c.req.query('orgId');
  if (!orgId) throw new HTTPException(400, { message: 'orgId required' });
  const report = await importStaffCsv(orgId, csv);
  return c.json(report);
});

// ── Bulk import: stage ────────────────────────────────────────────────────
staffRoutes.post('/import/stage', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const body = await c.req.json<{ csv: string; orgId?: string }>();
  const csv = body.csv;
  const orgId = body.orgId ?? c.req.query('orgId');
  if (!csv) throw new HTTPException(400, { message: 'csv is required' });
  if (!orgId) throw new HTTPException(400, { message: 'orgId required' });

  const result = await stageBatch(db, {
    orgId,
    actorUserId: actor.userId,
    csv,
  });
  return c.json(result);
});

// ── Bulk import: apply ────────────────────────────────────────────────────
staffRoutes.post('/import/apply', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const { batchId } = await c.req.json<{ batchId: string }>();
  if (!batchId) throw new HTTPException(400, { message: 'batchId required' });

  const result = await applyBatch(db, { batchId, actorUserId: actor.userId });
  if (!result.ok) throw new HTTPException(422, { message: result.error });
  return c.json(result);
});

// ── Bulk import: revert ───────────────────────────────────────────────────
staffRoutes.post('/import/revert', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const { batchId } = await c.req.json<{ batchId: string }>();
  if (!batchId) throw new HTTPException(400, { message: 'batchId required' });

  const result = await revertBatch(db, { batchId, actorUserId: actor.userId });
  if (!result.ok) throw new HTTPException(422, { message: result.error });
  return c.json(result);
});

// ── Bulk import: list batches ─────────────────────────────────────────────
staffRoutes.get('/import/batches', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const orgId = c.req.query('orgId');
  if (!orgId) throw new HTTPException(400, { message: 'orgId required' });

  const res = await db.execute(
    sql`select id, org_id, requested_by, csv_hash, row_count, status, validation_errors, created_at, applied_at, reverted_at
        from staff_import_batch
        where org_id = ${orgId}
        order by created_at desc
        limit 50`,
  );
  const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  return c.json({ batches: rows });
});
