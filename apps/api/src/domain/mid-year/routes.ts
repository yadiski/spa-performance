import { zValidator } from '@hono/zod-validator';
import { midYearAck, midYearSave, midYearSubmit, openMidYearWindow } from '@spa/shared';
import { Hono } from 'hono';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { openMidYearWindow as openWindowSvc } from '../cycle/windows';
import { ackMidYear, saveMidYearUpdate, submitMidYearUpdate } from './service';

export const midYearRoutes = new Hono();

midYearRoutes.use('*', requireAuth);

midYearRoutes.post('/open', zValidator('json', openMidYearWindow), async (c) => {
  const actor = c.get('actor');
  const body = c.req.valid('json');
  const r = await openWindowSvc(db, actor, body);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

midYearRoutes.post('/save', zValidator('json', midYearSave), async (c) => {
  const actor = c.get('actor');
  const body = c.req.valid('json');
  const r = await saveMidYearUpdate(db, actor, body);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

midYearRoutes.post('/submit', zValidator('json', midYearSubmit), async (c) => {
  const actor = c.get('actor');
  const body = c.req.valid('json');
  const r = await submitMidYearUpdate(db, actor, body);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

midYearRoutes.post('/ack', zValidator('json', midYearAck), async (c) => {
  const actor = c.get('actor');
  const body = c.req.valid('json');
  const r = await ackMidYear(db, actor, body);
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});
