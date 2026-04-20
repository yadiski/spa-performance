import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { writeAudit } from '../audit/log';
import { db } from '../db/client';
import { requireAuth } from './middleware';

export const sessionRoutes = new Hono();
sessionRoutes.use('*', requireAuth);

/**
 * POST /api/v1/auth/logout-all
 * Kills all sessions for the authenticated actor (self).
 */
sessionRoutes.post('/logout-all', async (c) => {
  const actor = c.get('actor');

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      delete from session where user_id = ${actor.userId}::uuid
    `);
    await writeAudit(tx, {
      eventType: 'auth.session.logout_all',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'user',
      targetId: actor.userId,
      payload: { targetUserId: actor.userId, reason: 'self' },
      ip: actor.ip,
      ua: actor.ua,
    });
  });

  return c.json({ ok: true });
});

export const adminSessionRoutes = new Hono();
adminSessionRoutes.use('*', requireAuth);

const logoutUserSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1),
});

/**
 * POST /api/v1/admin/auth/logout-user
 * IT admin kills all sessions for a target user.
 */
adminSessionRoutes.post('/logout-user', zValidator('json', logoutUserSchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden — it_admin required' });
  }

  const { userId, reason } = c.req.valid('json');

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      delete from session where user_id = ${userId}::uuid
    `);
    await writeAudit(tx, {
      eventType: 'auth.session.logout_all',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'user',
      targetId: userId,
      payload: { targetUserId: userId, reason, adminActor: actor.userId },
      ip: actor.ip,
      ua: actor.ua,
    });
  });

  return c.json({ ok: true });
});
