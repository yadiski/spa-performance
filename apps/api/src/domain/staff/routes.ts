import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../../auth/middleware';
import { importStaffCsv } from './import';

export const staffRoutes = new Hono();
staffRoutes.use('*', requireAuth);

staffRoutes.post('/import', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  const csv = await c.req.text();
  const orgId = c.req.query('orgId');
  if (!orgId) throw new HTTPException(400, { message: 'orgId required' });
  const report = await importStaffCsv(orgId, csv);
  return c.json(report);
});
