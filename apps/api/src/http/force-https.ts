/**
 * T15 — Force HTTPS middleware
 *
 * Railway terminates TLS at the edge and forwards requests with
 * `X-Forwarded-Proto: https`. In production, any request that arrives
 * without that header (plain HTTP) is redirected to the HTTPS equivalent.
 *
 * This guard only activates when NODE_ENV === 'production' so local dev
 * is unaffected.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';

export function forceHttps(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    if (process.env.NODE_ENV === 'production') {
      const proto = c.req.header('x-forwarded-proto');
      if (proto === 'http') {
        const url = new URL(c.req.url);
        url.protocol = 'https:';
        return c.redirect(url.toString(), 301);
      }
    }
    await next();
  };
}
