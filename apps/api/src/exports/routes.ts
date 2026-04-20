import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { db } from '../db/client';
import { exportJob, staff } from '../db/schema';
import { boss } from '../jobs/queue';
import { getSignedUrl } from '../storage/r2';

export const exportRoutes = new Hono();
exportRoutes.use('*', requireAuth);

// ── POST /api/v1/exports/pms-org ─────────────────────────────────────────────
// HRA only. Creates an export_job row and enqueues the xlsx generation job.
const postPmsOrgSchema = z.object({
  fy: z.number().int().optional(),
});

exportRoutes.post('/pms-org', zValidator('json', postPmsOrgSchema), async (c) => {
  const actor = c.get('actor');

  if (!actor.roles.includes('hra')) {
    throw new HTTPException(403, { message: 'HRA role required' });
  }

  if (!actor.staffId) {
    throw new HTTPException(403, { message: 'No staff record associated with this user' });
  }

  const { fy } = c.req.valid('json');

  // Resolve org_id from the actor's staff record
  const [staffRow] = await db
    .select({ orgId: staff.orgId })
    .from(staff)
    .where(eq(staff.id, actor.staffId))
    .limit(1);

  if (!staffRow) {
    throw new HTTPException(403, { message: 'Staff record not found' });
  }

  const params: Record<string, unknown> = {};
  if (fy !== undefined) params.fy = fy;

  const [job] = await db
    .insert(exportJob)
    .values({
      kind: 'pms_org_snapshot',
      requestedBy: actor.userId,
      orgId: staffRow.orgId,
      params,
      status: 'queued',
    })
    .returning();

  if (!job) {
    throw new HTTPException(500, { message: 'Failed to create export job' });
  }

  await boss.send('exports.generate_xlsx', { exportJobId: job.id });

  return c.json({ id: job.id, status: 'queued' }, 201);
});

// ── GET /api/v1/exports/:id ───────────────────────────────────────────────────
// Returns the job row. If ready, includes a signed URL.
// Scoping: actor must be the requester OR HRA.
const getByIdParamSchema = z.object({ id: z.string().uuid() });

exportRoutes.get('/:id', zValidator('param', getByIdParamSchema), async (c) => {
  const actor = c.get('actor');
  const { id } = c.req.valid('param');

  const [job] = await db.select().from(exportJob).where(eq(exportJob.id, id)).limit(1);

  if (!job) {
    throw new HTTPException(404, { message: 'Export job not found' });
  }

  // Scoping: requester must be the job owner OR have HRA role
  const isOwner = job.requestedBy === actor.userId;
  const isHra = actor.roles.includes('hra');

  if (!isOwner && !isHra) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }

  const response: Record<string, unknown> = {
    id: job.id,
    kind: job.kind,
    status: job.status,
    params: job.params,
    rowCount: job.rowCount,
    sha256: job.sha256,
    error: job.error,
    requestedAt: job.requestedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };

  if (job.status === 'ready' && job.r2Key) {
    const ttlSec = 86400;
    const url = await getSignedUrl(job.r2Key, ttlSec);
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
    response.url = url;
    response.expiresAt = expiresAt;
  }

  return c.json(response);
});

// ── GET /api/v1/exports ───────────────────────────────────────────────────────
// List export jobs. HRA sees all; others see their own.
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

exportRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const actor = c.get('actor');
  const { limit, offset } = c.req.valid('query');

  const isHra = actor.roles.includes('hra');

  const rows = await db
    .select()
    .from(exportJob)
    .where(isHra ? undefined : eq(exportJob.requestedBy, actor.userId))
    .orderBy(desc(exportJob.requestedAt))
    .limit(limit)
    .offset(offset);

  const items = rows.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    params: job.params,
    rowCount: job.rowCount,
    sha256: job.sha256,
    error: job.error,
    requestedAt: job.requestedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  }));

  return c.json({ items, limit, offset });
});
