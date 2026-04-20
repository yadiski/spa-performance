import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { isLocked, recordFailedAttempt } from './lockout';
import { consumeRecoveryCode } from './mfa-recovery';

export const mfaRecoveryRoutes = new Hono();

const recoverSchema = z.object({
  email: z.string().email(),
  recoveryCode: z.string().min(1),
});

/**
 * POST /api/v1/auth/mfa-recover
 * Consumes a single-use recovery code. On success, marks TOTP for re-enrollment
 * by deleting the two_factor secret row (next login will require re-enrollment).
 */
mfaRecoveryRoutes.post('/mfa-recover', zValidator('json', recoverSchema), async (c) => {
  const { email, recoveryCode } = c.req.valid('json');
  const ipRaw = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();

  // Look up user by email
  const userRes = await db.execute(sql`
    select id from "user" where email = ${email} limit 1
  `);
  const userRows = (
    Array.isArray(userRes) ? userRes : ((userRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: string }>;

  if (userRows.length === 0) {
    // Don't reveal whether email exists
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  const userId = userRows[0]!.id;

  // Check lockout
  const locked = await isLocked(db, userId);
  if (locked) {
    return c.json({ ok: false, error: 'account_locked' }, 403);
  }

  const result = await consumeRecoveryCode(db, userId, recoveryCode);

  if (!result.ok) {
    // Record failed attempt
    const failOpts: Parameters<typeof recordFailedAttempt>[1] = {
      userId,
      email,
      ...(ipRaw ? { ip: ipRaw } : {}),
    };
    await recordFailedAttempt(db, failOpts);
    return c.json({ ok: false, error: 'invalid_recovery_code' }, 401);
  }

  // Invalidate TOTP: delete the two_factor row, forcing re-enrollment
  await db.execute(sql`
    delete from two_factor where user_id = ${userId}::uuid
  `);

  // Also update the user's two_factor_enabled flag
  await db.execute(sql`
    update "user" set two_factor_enabled = false, updated_at = now()
    where id = ${userId}::uuid
  `);

  return c.json({ ok: true, message: 'Recovery code accepted. MFA re-enrollment required.' });
});
