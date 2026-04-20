import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../db/client';
import { endImpersonation, getActiveImpersonation, startImpersonation } from './impersonation';
import { requireAuth } from './middleware';

export const impersonationRoutes = new Hono();
impersonationRoutes.use('*', requireAuth);

const startSchema = z.object({
  targetUserId: z.string().uuid(),
  reason: z.string().min(1),
  durationMin: z.number().int().min(1).max(60).optional(),
});

impersonationRoutes.post('/start', zValidator('json', startSchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden — it_admin required' });
  }

  const body = c.req.valid('json');
  const opts: Parameters<typeof startImpersonation>[1] = {
    actor,
    targetUserId: body.targetUserId,
    reason: body.reason,
    ...(body.durationMin !== undefined ? { durationMin: body.durationMin } : {}),
  };
  const result = await startImpersonation(db, opts);

  if ('error' in result) {
    const status = result.error.includes('forbidden') ? 403 : 400;
    return c.json({ ok: false, error: result.error }, status);
  }

  return c.json({ ok: true, sessionId: result.sessionId, expiresAt: result.expiresAt });
});

const stopSchema = z.object({
  sessionId: z.string().uuid().optional(),
  reason: z.string().optional(),
});

impersonationRoutes.post('/stop', zValidator('json', stopSchema), async (c) => {
  const actor = c.get('actor');
  const { sessionId, reason } = c.req.valid('json');

  let resolvedSessionId = sessionId;
  if (!resolvedSessionId) {
    // Auto-resolve: find the actor's current active session
    const active = await getActiveImpersonation(db, actor.userId);
    if (!active) {
      return c.json({ ok: false, error: 'no active impersonation session' }, 404);
    }
    resolvedSessionId = active.sessionId;
  }

  const endOpts: Parameters<typeof endImpersonation>[1] = {
    actor,
    sessionId: resolvedSessionId,
    ...(reason !== undefined ? { reason } : {}),
  };
  await endImpersonation(db, endOpts);
  return c.json({ ok: true });
});

impersonationRoutes.get('/active', async (c) => {
  const actor = c.get('actor');
  const active = await getActiveImpersonation(db, actor.userId);
  return c.json({ active: active ?? null });
});
