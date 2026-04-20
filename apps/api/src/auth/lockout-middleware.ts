import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/client';
import { checkAndMaybeLock, isLocked, recordFailedAttempt } from './lockout';

/**
 * Middleware that wraps better-auth's sign-in/email handler.
 * Before forwarding to better-auth:
 *   - Reads email from request body
 *   - Looks up user by email
 *   - Checks if account is locked; if so, returns 403 with code `account_locked`
 * After better-auth responds (via passthrough):
 *   - If better-auth returned 401/403, record a failed attempt and potentially lock
 */
export const lockoutMiddleware: MiddlewareHandler = async (c, next) => {
  const url = new URL(c.req.url);
  const isSignIn = url.pathname.includes('/sign-in/email');

  if (!isSignIn) {
    await next();
    return;
  }

  // Read body to get email (need to clone request for passthrough)
  let email: string | null = null;
  let userId: string | null = null;

  try {
    const cloned = c.req.raw.clone();
    const body = await cloned.json();
    email = typeof body?.email === 'string' ? body.email : null;
  } catch {
    // Can't parse body — let better-auth handle it
    await next();
    return;
  }

  if (email) {
    // Look up user
    try {
      const userRes = await db.execute(sql`
        select id from "user" where email = ${email} limit 1
      `);
      const userRows = (
        Array.isArray(userRes) ? userRes : ((userRes as { rows?: unknown[] }).rows ?? [])
      ) as Array<{ id: string }>;
      userId = userRows[0]?.id ?? null;
    } catch {
      // DB error — don't block
    }

    if (userId) {
      const locked = await isLocked(db, userId);
      if (locked) {
        return c.json(
          { error: 'ACCOUNT_LOCKED', message: 'Account is locked due to too many failed attempts' },
          403,
        );
      }
    }
  }

  // Let better-auth process the request
  await next();

  // After better-auth responds: if 401 or 422, record failed attempt
  if (c.res.status === 401 || c.res.status === 422 || c.res.status === 400) {
    if (email) {
      const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      const ua = c.req.header('user-agent') ?? undefined;
      const attemptOpts: Parameters<typeof recordFailedAttempt>[1] = {
        email,
        ...(userId ? { userId } : {}),
        ...(ip ? { ip } : {}),
        ...(ua ? { ua } : {}),
      };
      await recordFailedAttempt(db, attemptOpts);

      if (userId) {
        await checkAndMaybeLock(db, userId);
      }
    }
  }
};
