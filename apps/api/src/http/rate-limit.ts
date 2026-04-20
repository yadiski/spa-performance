/**
 * T13 — Per-route rate limits (fixed-window counter in Postgres)
 *
 * Strategy:
 *   window_start = floor(epoch_seconds / windowSec) * windowSec
 *   bucket_key   = "<class>:<identifier>:<window_start>"
 *
 * An UPSERT atomically increments the counter. If it exceeds capacity the
 * request gets a 429 with a `Retry-After` header pointing to the end of the
 * current window.
 *
 * AI routes keep their own `ai_rate_limit` table from Phase 3 and are NOT
 * touched here.
 *
 * In-memory rate-limit-hit dedup set:
 *   To avoid flooding audit_log with a row per over-limit request we track
 *   the last minute in which each bucket was logged. A 429 only writes an
 *   audit row once per 60-second calendar minute per bucket.
 */

import { sql } from 'drizzle-orm';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { writeAudit } from '../audit/log';
import { db as defaultDb } from '../db/client';
import type { DB } from '../db/client';

export interface RateLimitOptions {
  class: 'auth' | 'mutating' | 'read';
  key: (c: Context) => string;
  /** Window size in seconds */
  windowSec: number;
  /** Max requests allowed in the window */
  capacity: number;
  /** Injected DB for testing — falls back to the singleton */
  db?: DB | undefined;
}

/** Tracks which (bucketKey, minuteSlot) combos have already emitted an audit row. */
const auditDedup = new Map<string, number>();

function currentMinuteSlot(): number {
  return Math.floor(Date.now() / 60_000);
}

function pruneDedup() {
  const slot = currentMinuteSlot();
  for (const [k, v] of auditDedup) {
    if (v < slot - 1) auditDedup.delete(k);
  }
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    // Skip rate-limiting in test environment unless an injected DB is provided
    // (injected DB means a test is explicitly exercising the rate-limit logic)
    if (process.env.NODE_ENV === 'test' && opts.db === undefined) {
      await next();
      return;
    }

    const database = opts.db ?? defaultDb;

    const identifier = opts.key(c);
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / opts.windowSec) * opts.windowSec;
    const bucketKey = `${opts.class}:${identifier}:${windowStart}`;
    const windowEndsAt = windowStart + opts.windowSec;
    const retryAfter = windowEndsAt - now;

    // Atomic upsert — returns the new counter value
    const result = await database.execute(sql`
      INSERT INTO http_rate_limit (bucket_key, requests, last_at)
      VALUES (${bucketKey}, 1, now())
      ON CONFLICT (bucket_key) DO UPDATE
        SET requests = http_rate_limit.requests + 1,
            last_at  = now()
      RETURNING requests
    `);

    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ requests: number }>;

    const count = Number(rows[0]?.requests ?? 1);

    if (count > opts.capacity) {
      // Write audit row — once per (bucket, minute) to avoid flooding
      pruneDedup();
      const minuteSlot = currentMinuteSlot();
      const dedupKey = `${bucketKey}:${minuteSlot}`;
      if (!auditDedup.has(dedupKey)) {
        auditDedup.set(dedupKey, minuteSlot);
        try {
          await database.transaction(async (tx) => {
            await writeAudit(tx, {
              eventType: 'security.rate_limit_hit',
              actorId: null,
              actorRole: null,
              targetType: 'http_bucket',
              targetId: bucketKey,
              payload: {
                class: opts.class,
                identifier,
                capacity: opts.capacity,
                windowSec: opts.windowSec,
                count,
              },
              ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
              ua: c.req.header('user-agent') ?? null,
            });
          });
        } catch {
          // Audit failure must never block the 429 response
        }
      }

      c.res = new Response(
        JSON.stringify({ code: 'rate_limit_exceeded', message: 'Too many requests' }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(opts.capacity),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(windowEndsAt),
          },
        },
      );
      return;
    }

    c.res.headers.set('X-RateLimit-Limit', String(opts.capacity));
    c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, opts.capacity - count)));
    c.res.headers.set('X-RateLimit-Reset', String(windowEndsAt));

    await next();
  };
}

// ─── Pre-built middleware instances ──────────────────────────────────────────

/** Auth routes: 10 req/min/IP */
export function authIpRateLimit(injectedDb?: DB | undefined): MiddlewareHandler {
  const opts: RateLimitOptions = {
    class: 'auth',
    key: (c) => `ip:${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`,
    windowSec: 60,
    capacity: 10,
  };
  if (injectedDb !== undefined) opts.db = injectedDb;
  return rateLimit(opts);
}

/** Auth routes: 20 req/min/user (only if authenticated) */
export function authUserRateLimit(injectedDb?: DB | undefined): MiddlewareHandler {
  const opts: RateLimitOptions = {
    class: 'auth',
    key: (c) => {
      // actor may not be set yet on auth routes — fall back to IP
      const actor = c.get('actor' as never) as { userId?: string } | undefined;
      return actor?.userId
        ? `user:${actor.userId}`
        : `ip:${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`;
    },
    windowSec: 60,
    capacity: 20,
  };
  if (injectedDb !== undefined) opts.db = injectedDb;
  return rateLimit(opts);
}

/** Mutating API routes: 60 req/min/user */
export function mutatingRateLimit(injectedDb?: DB | undefined): MiddlewareHandler {
  const mutOpts: RateLimitOptions = {
    class: 'mutating',
    key: (c) => {
      const actor = c.get('actor' as never) as { userId?: string } | undefined;
      return actor?.userId
        ? `user:${actor.userId}`
        : `ip:${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`;
    },
    windowSec: 60,
    capacity: 60,
  };
  if (injectedDb !== undefined) mutOpts.db = injectedDb;
  const inner = rateLimit(mutOpts);

  return async (c: Context, next: Next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
      return inner(c, next);
    }
    await next();
  };
}
