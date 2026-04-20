/**
 * T14 — CORS tightening
 *
 * Only the configured WEB_ORIGIN (and Vite dev server in non-production) are
 * allowed. Unknown origins receive no CORS headers, which causes the browser
 * to block the response.
 *
 * Additional origins (e.g. staging front-ends) can be added via the
 * ADDITIONAL_CORS_ORIGINS environment variable (comma-separated URLs).
 */

import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: (origin) => {
    const allowed: string[] = [];

    if (process.env.WEB_ORIGIN) {
      allowed.push(process.env.WEB_ORIGIN);
    }

    if (process.env.NODE_ENV !== 'production') {
      allowed.push('http://localhost:5173'); // Vite dev server
    }

    if (process.env.ADDITIONAL_CORS_ORIGINS) {
      allowed.push(...process.env.ADDITIONAL_CORS_ORIGINS.split(',').map((s) => s.trim()));
    }

    return allowed.includes(origin ?? '') ? (origin ?? null) : null;
  },
  credentials: true,
  allowHeaders: ['content-type', 'authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 600,
});
