import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import { logInfo } from '../observability/logger';

/**
 * Request-ID middleware.
 *
 * - Reads X-Request-Id from the incoming request if present; otherwise generates a UUID v4.
 * - Stores the id in Hono context as `requestId` (accessible via `c.get('requestId')`).
 * - Echoes the id back in the X-Request-Id response header.
 * - Logs an http.request event after the handler completes.
 *
 * Mount near the top of app.ts so all downstream handlers have access to the id.
 */
export async function requestIdMiddleware(c: Context, next: Next): Promise<void> {
  const id = c.req.header('x-request-id') ?? randomUUID();
  c.set('requestId', id);

  const start = Date.now();
  await next();

  c.header('X-Request-Id', id);

  logInfo('http.request', {
    requestId: id,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
}
