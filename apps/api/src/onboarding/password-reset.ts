import { createHash, randomBytes } from 'node:crypto';
import { NotificationKind } from '@spa/shared';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';
import { boss } from '../jobs/queue';
import type { SendEmailJob } from '../jobs/send-email';

const EMAIL_QUEUE = 'notifications.send_email';
const RESET_TTL_HOURS = 1;

function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  return { token, tokenHash };
}

/**
 * Initiates a password reset — always "succeeds" to prevent email enumeration.
 * If user exists, inserts a token row and queues a reset email.
 */
export async function initiatePasswordReset(
  db: DB,
  opts: { email: string; ip?: string },
): Promise<void> {
  const { email, ip } = opts;

  // Lookup user — do not reveal whether user exists
  const userRes = await db.execute(sql`
    select id from "user" where email = ${email} limit 1
  `);
  const userRows = (
    Array.isArray(userRes) ? userRes : ((userRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: string }>;

  const user = userRows[0];
  if (!user) {
    // Always return without error to prevent enumeration
    return;
  }

  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);

  await db.execute(sql`
    insert into password_reset_token (user_id, token_hash, expires_at)
    values (${user.id}::uuid, ${tokenHash}, ${expiresAt.toISOString()}::timestamptz)
  `);

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const resetUrl = `${webOrigin}/password-reset/${token}`;

  const emailJob: SendEmailJob = {
    to: email,
    kind: NotificationKind.PasswordReset,
    payload: { resetUrl },
  };
  await boss.send(EMAIL_QUEUE, emailJob);
}

/**
 * Accepts a password reset token and sets a new password.
 * Kills all existing sessions and audits the event.
 */
export async function acceptPasswordReset(
  db: DB,
  opts: { token: string; newPassword: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { token, newPassword } = opts;

  if (newPassword.length < 12) {
    return { ok: false, error: 'Password must be at least 12 characters' };
  }

  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  // Look up token
  const tokenRes = await db.execute(sql`
    select id, user_id, expires_at, used_at
    from password_reset_token
    where token_hash = ${tokenHash}
    limit 1
  `);
  const tokenRows = (
    Array.isArray(tokenRes) ? tokenRes : ((tokenRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{
    id: string;
    user_id: string;
    expires_at: Date;
    used_at: Date | null;
  }>;

  const resetToken = tokenRows[0];
  if (!resetToken) {
    return { ok: false, error: 'Invalid or expired password reset link' };
  }
  if (resetToken.used_at) {
    return { ok: false, error: 'This password reset link has already been used' };
  }
  if (new Date(resetToken.expires_at) < new Date()) {
    return { ok: false, error: 'Password reset link has expired' };
  }

  // Hash the new password using better-auth's own scrypt utility
  // This ensures the stored hash is compatible with better-auth's credential verification
  const { hashPassword } = await import('better-auth/crypto');
  const newPasswordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    // Update password in account table
    await tx.execute(sql`
      update account
      set password = ${newPasswordHash}, updated_at = now()
      where user_id = ${resetToken.user_id}::uuid
        and provider_id = 'credential'
    `);

    // Mark token as used
    await tx.execute(sql`
      update password_reset_token
      set used_at = now()
      where id = ${resetToken.id}::uuid
    `);

    // Kill all sessions for this user
    await tx.execute(sql`
      delete from session where user_id = ${resetToken.user_id}::uuid
    `);

    await writeAudit(tx, {
      eventType: 'auth.password_reset',
      actorId: resetToken.user_id,
      actorRole: null,
      targetType: 'user',
      targetId: resetToken.user_id,
      payload: { tokenId: resetToken.id },
      ip: null,
      ua: null,
    });
  });

  return { ok: true };
}

export async function verifyResetToken(
  db: DB,
  token: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  const res = await db.execute(sql`
    select user_id, expires_at, used_at
    from password_reset_token
    where token_hash = ${tokenHash}
    limit 1
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    user_id: string;
    expires_at: Date;
    used_at: Date | null;
  }>;

  const row = rows[0];
  if (!row) return { ok: false, error: 'not_found' };
  if (row.used_at) return { ok: false, error: 'already_used' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: 'expired' };

  return { ok: true, userId: row.user_id };
}
