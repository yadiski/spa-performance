import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { kraCreateBatch, kraApprove, kraReject } from '@spa/shared';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { saveKraDraft, submitKras, approveKras, rejectKras } from './service';

export const kraRoutes = new Hono();

kraRoutes.use('*', requireAuth);

kraRoutes.post('/draft', zValidator('json', kraCreateBatch), async (c) => {
  const actor = c.get('actor');
  const body = c.req.valid('json');
  const r = await saveKraDraft(db, actor, body);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

kraRoutes.post('/submit/:cycleId', async (c) => {
  const actor = c.get('actor');
  const r = await submitKras(db, actor, c.req.param('cycleId'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

kraRoutes.post('/approve', zValidator('json', kraApprove), async (c) => {
  const actor = c.get('actor');
  const r = await approveKras(db, actor, c.req.valid('json').cycleId);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

kraRoutes.post('/reject', zValidator('json', kraReject), async (c) => {
  const actor = c.get('actor');
  const body = c.req.valid('json');
  const r = await rejectKras(db, actor, body.cycleId, body.note);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});
