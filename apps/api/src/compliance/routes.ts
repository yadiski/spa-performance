import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { db } from '../db/client';
import { applyAccessReviewDecision } from './access-review';

export const accessReviewRoutes = new Hono();
accessReviewRoutes.use('*', requireAuth);

function requireHraOrAdmin(roles: string[]) {
  if (!roles.includes('hra') && !roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden — hra or it_admin required' });
  }
}

/** GET /api/v1/admin/access-review/cycles */
accessReviewRoutes.get('/cycles', async (c) => {
  const actor = c.get('actor');
  requireHraOrAdmin(actor.roles);

  const res = await db.execute(sql`
    select id, period_start, period_end, generated_at, status, completed_at, created_by_system
    from access_review_cycle
    order by generated_at desc
    limit 20
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<
    Record<string, unknown>
  >;

  return c.json({ cycles: rows });
});

/** GET /api/v1/admin/access-review/cycles/:id/items?decision=pending&limit=50 */
accessReviewRoutes.get('/cycles/:id/items', async (c) => {
  const actor = c.get('actor');
  requireHraOrAdmin(actor.roles);

  const { id } = c.req.param();
  const decisionFilter = c.req.query('decision') ?? null;
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);

  const res = await db.execute(sql`
    select
      i.id, i.user_id, i.snapshot, i.decision, i.decision_reason, i.decided_at,
      i.decided_by_user_id
    from access_review_item i
    where i.cycle_id = ${id}::uuid
      and (${decisionFilter}::text is null
           or (${decisionFilter} = 'pending' and i.decision is null)
           or i.decision = ${decisionFilter}::text)
    order by i.id
    limit ${limit}
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<
    Record<string, unknown>
  >;

  return c.json({ items: rows });
});

const decideSchema = z.object({
  decision: z.enum(['approved', 'revoked', 'deferred']),
  reason: z.string().optional(),
});

/** POST /api/v1/admin/access-review/items/:id/decide */
accessReviewRoutes.post('/items/:id/decide', zValidator('json', decideSchema), async (c) => {
  const actor = c.get('actor');
  requireHraOrAdmin(actor.roles);

  const { id } = c.req.param();
  const { decision, reason } = c.req.valid('json');

  if (decision === 'revoked' && !reason) {
    throw new HTTPException(400, { message: 'reason is required when revoking access' });
  }

  try {
    await applyAccessReviewDecision(db, {
      itemId: id,
      decision,
      ...(reason !== undefined ? { reason } : {}),
      actorUserId: actor.userId,
    });
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to apply decision';
    throw new HTTPException(400, { message: msg });
  }
});
