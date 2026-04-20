import { Hono } from 'hono';
import { requireAuth } from '../auth/middleware';
import { db } from '../db/client';
import { searchStaff } from './staff-search';

export const searchRoutes = new Hono();
searchRoutes.use('*', requireAuth);

// GET /api/v1/search/staff?q=...&limit=20&offset=0
searchRoutes.get('/staff', async (c) => {
  const actor = c.get('actor');

  const q = c.req.query('q') ?? '';
  const limit = Math.min(Number(c.req.query('limit') ?? '20') || 20, 100);
  const offset = Math.max(Number(c.req.query('offset') ?? '0') || 0, 0);

  const result = await searchStaff(db, actor, { q, limit, offset });
  return c.json(result);
});
