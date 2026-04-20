import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../db/client';
import { unlockAccount } from './lockout';
import { requireAuth } from './middleware';

export const authAdminRoutes = new Hono();
authAdminRoutes.use('*', requireAuth);

const unlockSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1),
});

/**
 * POST /api/v1/admin/auth/unlock
 * HRA or IT admin unlocks a locked account.
 */
authAdminRoutes.post('/unlock', zValidator('json', unlockSchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden — hra or it_admin required' });
  }

  const { userId, reason } = c.req.valid('json');
  await unlockAccount(db, { userId, actorUserId: actor.userId, reason });

  return c.json({ ok: true });
});
