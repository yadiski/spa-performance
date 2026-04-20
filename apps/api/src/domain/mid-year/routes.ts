import { zValidator } from '@hono/zod-validator';
import { midYearAck, midYearSave, midYearSubmit, openMidYearWindow } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import {
  kraProgressUpdate,
  kra as kraT,
  midYearCheckpoint,
  performanceCycle,
} from '../../db/schema';
import { staffReadScope } from '../../rbac/scope';
import { openMidYearWindow as openWindowSvc } from '../cycle/windows';
import { ackMidYear, saveMidYearUpdate, submitMidYearUpdate } from './service';

export const midYearRoutes = new Hono();

midYearRoutes.use('*', requireAuth);

midYearRoutes.post('/open', zValidator('json', openMidYearWindow), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
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

midYearRoutes.get('/:cycleId', async (c) => {
  const actor = c.get('actor');
  const cycleId = c.req.param('cycleId');

  // Ownership check: actor must be in scope for the cycle's staff member
  const [cycle] = await db.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
  if (!cycle) return c.json({ code: 'cycle_not_found', message: 'cycle_not_found' }, 404);

  const scope = await staffReadScope(db, actor);
  const accessible = await db.execute(
    sql`select 1 from staff where id = ${cycle.staffId} and (${scope})`,
  );
  const accessRows = Array.isArray(accessible)
    ? accessible
    : ((accessible as { rows?: unknown[] }).rows ?? []);
  if (accessRows.length === 0) return c.json({ code: 'forbidden', message: 'forbidden' }, 403);

  const res = await db.execute(sql`
    select u.id, u.kra_id as "kraId", u.result_achieved as "resultAchieved",
           u.rating_1_to_5 as "rating1to5", u.by_role as "byRole"
    from kra_progress_update u
    join kra k on k.id = u.kra_id
    where k.cycle_id = ${cycleId} and u.by_role = 'mid_year'
    order by k.order asc
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: string;
    kraId: string;
    resultAchieved: string;
    rating1to5: number;
    byRole: string;
  }>;
  const [cp] = await db
    .select()
    .from(midYearCheckpoint)
    .where(eq(midYearCheckpoint.cycleId, cycleId));
  return c.json({ updates: rows, summary: cp?.summary ?? null });
});
