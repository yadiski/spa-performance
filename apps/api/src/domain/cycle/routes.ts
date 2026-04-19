import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { performanceCycle } from '../../db/schema';

export const cycleRoutes = new Hono();
cycleRoutes.use('*', requireAuth);

cycleRoutes.get('/current', async (c) => {
  const actor = c.get('actor');
  if (!actor.staffId) return c.json({ cycle: null });
  const [row] = await db
    .select()
    .from(performanceCycle)
    .where(eq(performanceCycle.staffId, actor.staffId))
    .orderBy(desc(performanceCycle.fy))
    .limit(1);
  return c.json({ cycle: row ?? null });
});

cycleRoutes.get('/for-staff/:staffId', async (c) => {
  const staffId = c.req.param('staffId');
  const [row] = await db
    .select()
    .from(performanceCycle)
    .where(eq(performanceCycle.staffId, staffId))
    .orderBy(desc(performanceCycle.fy))
    .limit(1);
  if (!row) return c.json({ cycle: null }, 404);
  return c.json({ cycle: row });
});
