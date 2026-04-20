import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { notification } from '../../db/schema';

export const notificationRoutes = new Hono();
notificationRoutes.use('*', requireAuth);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  unread: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

notificationRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.staffId) return c.json({ items: [] });

  const { limit, unread } = c.req.valid('query');

  const rows = await db
    .select()
    .from(notification)
    .where(
      and(
        eq(notification.recipientStaffId, actor.staffId),
        unread ? isNull(notification.readAt) : undefined,
      ),
    )
    .orderBy(sql`${notification.createdAt} desc`)
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    targetType: r.targetType,
    targetId: r.targetId,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return c.json({ items });
});

notificationRoutes.get('/unread-count', async (c) => {
  const actor = c.get('actor');
  if (!actor.staffId) return c.json({ count: 0 });

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.recipientStaffId, actor.staffId), isNull(notification.readAt)));

  return c.json({ count: row?.count ?? 0 });
});

notificationRoutes.patch('/read-all', async (c) => {
  const actor = c.get('actor');
  if (!actor.staffId) return c.json({ ok: true, updated: 0 });

  const updated = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.recipientStaffId, actor.staffId), isNull(notification.readAt)))
    .returning({ id: notification.id });

  return c.json({ ok: true, updated: updated.length });
});

const readParamSchema = z.object({ id: z.string().uuid() });

notificationRoutes.patch('/:id/read', zValidator('param', readParamSchema), async (c) => {
  const actor = c.get('actor');
  const { id } = c.req.valid('param');

  if (!actor.staffId) {
    return c.json({ code: 'not_found', message: 'not_found' }, 404);
  }

  const [row] = await db.select().from(notification).where(eq(notification.id, id)).limit(1);

  if (!row || row.recipientStaffId !== actor.staffId) {
    return c.json({ code: 'not_found', message: 'not_found' }, 404);
  }

  if (!row.readAt) {
    await db.update(notification).set({ readAt: new Date() }).where(eq(notification.id, id));
  }

  return c.json({ ok: true, id });
});
