import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../auth/middleware';
import { db } from '../db/client';
import { verifyChain } from './verifier';

export const auditRoutes = new Hono();

auditRoutes.use('*', requireAuth);

/**
 * GET /api/v1/admin/audit/verify?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * HRA or IT admin only. Calls verifyChain for the requested date range.
 * Returns { ok: true, rowsChecked } or { ok: false, firstFailureAt, reason }.
 */
auditRoutes.get('/verify', async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden — hra or it_admin required' });
  }

  const fromParam = c.req.query('from');
  const toParam = c.req.query('to');

  if (!fromParam || !toParam) {
    throw new HTTPException(400, { message: 'from and to query params required (YYYY-MM-DD)' });
  }

  // Basic date validation
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(fromParam) || !dateRe.test(toParam)) {
    throw new HTTPException(400, { message: 'from and to must be YYYY-MM-DD' });
  }

  if (fromParam > toParam) {
    throw new HTTPException(400, { message: 'from must be <= to' });
  }

  const result = await verifyChain(db, fromParam, toParam);

  if (result.ok) {
    return c.json({ ok: true });
  }

  return c.json(
    {
      ok: false,
      firstFailureAt: String(result.failedId),
      reason: `hash mismatch at audit_log id ${result.failedId}`,
    },
    200,
  );
});
