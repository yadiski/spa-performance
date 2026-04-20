import { createHash, randomBytes } from 'node:crypto';
import { NotificationKind } from '@spa/shared';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { Actor } from '../auth/middleware';
import type { DB } from '../db/client';
import { boss } from '../jobs/queue';
import type { SendEmailJob } from '../jobs/send-email';

const EMAIL_QUEUE = 'notifications.send_email';
const INVITE_TTL_DAYS = 7;

export interface CreateInviteInput {
  db: DB;
  actor: Actor;
  email: string;
  staffId?: string;
  roles: string[];
  orgId: string;
}

function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  return { token, tokenHash };
}

export async function createInvite(
  input: CreateInviteInput,
): Promise<{ inviteId: string; token: string; url: string }> {
  const { db, actor, email, staffId, roles, orgId } = input;

  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new Error('forbidden — hra or it_admin required');
  }

  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const inviteId = await db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      insert into user_invite (email, token_hash, invited_by_user_id, org_id, staff_id, roles, expires_at)
      values (
        ${email},
        ${tokenHash},
        ${actor.userId}::uuid,
        ${orgId}::uuid,
        ${staffId ?? null}::uuid,
        ${`{${roles.map((r) => `"${r}"`).join(',')}}`}::text[],
        ${expiresAt.toISOString()}::timestamptz
      )
      returning id
    `);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      id: string;
    }>;
    const id = rows[0]!.id;

    await writeAudit(tx, {
      eventType: 'invite.created',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'user_invite',
      targetId: id,
      payload: { email, roles, orgId },
      ip: actor.ip,
      ua: actor.ua,
    });

    return id;
  });

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const url = `${webOrigin}/invite/${token}`;

  const emailJob: SendEmailJob = {
    to: email,
    kind: NotificationKind.InviteUser,
    payload: { inviteUrl: url },
  };
  await boss.send(EMAIL_QUEUE, emailJob);

  return { inviteId, token, url };
}

export async function acceptInvite(
  db: DB,
  opts: { token: string; password: string },
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const { token, password } = opts;
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  // Check password policy minimum length (12 chars) — avoid HIBP for invite flow
  if (password.length < 12) {
    return { ok: false, error: 'Password must be at least 12 characters' };
  }

  // Look up invite
  const inviteRes = await db.execute(sql`
    select id, email, roles, org_id, staff_id, expires_at, accepted_at
    from user_invite
    where token_hash = ${tokenHash}
    limit 1
  `);
  const inviteRows = (
    Array.isArray(inviteRes) ? inviteRes : ((inviteRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{
    id: string;
    email: string;
    roles: string[];
    org_id: string;
    staff_id: string | null;
    expires_at: Date;
    accepted_at: Date | null;
  }>;

  const invite = inviteRows[0];
  if (!invite) {
    return { ok: false, error: 'Invalid or expired invitation link' };
  }
  if (invite.accepted_at) {
    return { ok: false, error: 'Invitation has already been used' };
  }
  if (new Date(invite.expires_at) < new Date()) {
    return { ok: false, error: 'Invitation has expired' };
  }

  // Check if user already exists
  const existingUserRes = await db.execute(sql`
    select id from "user" where email = ${invite.email} limit 1
  `);
  const existingRows = (
    Array.isArray(existingUserRes)
      ? existingUserRes
      : ((existingUserRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: string }>;

  if (existingRows.length > 0) {
    return { ok: false, error: 'An account with this email already exists' };
  }

  // Hash password using better-auth's own hashing utility (scrypt via @noble/hashes)
  // This ensures the stored hash is compatible with better-auth's credential verification
  const { hashPassword } = await import('better-auth/crypto');
  const passwordHash = await hashPassword(password);

  const userId = await db.transaction(async (tx) => {
    // Create user row
    const userRes = await tx.execute(sql`
      insert into "user" (email, name, email_verified, created_at, updated_at)
      values (${invite.email}, ${invite.email}, false, now(), now())
      returning id
    `);
    const userRows = (
      Array.isArray(userRes) ? userRes : ((userRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const newUserId = userRows[0]!.id;

    // Create account row (credential provider)
    await tx.execute(sql`
      insert into account (user_id, provider_id, account_id, password, created_at, updated_at)
      values (${newUserId}::uuid, 'credential', ${invite.email}, ${passwordHash}, now(), now())
    `);

    // If staff_id exists, link staff to user
    if (invite.staff_id) {
      await tx.execute(sql`
        update staff set user_id = ${newUserId}::uuid
        where id = ${invite.staff_id}::uuid and user_id is null
      `);

      // Assign roles
      for (const role of invite.roles) {
        await tx.execute(sql`
          insert into staff_role (staff_id, role)
          values (${invite.staff_id}::uuid, ${role}::role)
          on conflict do nothing
        `);
      }
    }

    // Mark invite as accepted
    await tx.execute(sql`
      update user_invite set accepted_at = now() where id = ${invite.id}::uuid
    `);

    await writeAudit(tx, {
      eventType: 'invite.accepted',
      actorId: newUserId,
      actorRole: null,
      targetType: 'user_invite',
      targetId: invite.id,
      payload: { email: invite.email, roles: invite.roles },
      ip: null,
      ua: null,
    });

    return newUserId;
  });

  // Queue welcome email
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const emailJob: SendEmailJob = {
    to: invite.email,
    kind: NotificationKind.WelcomeUser,
    payload: {
      name: invite.email,
      helpUrl: `${webOrigin}/help`,
    },
  };
  await boss.send(EMAIL_QUEUE, emailJob);

  return { ok: true, userId };
}

export async function verifyInviteToken(
  db: DB,
  token: string,
): Promise<
  { ok: true; email: string; roles: string[]; expiresAt: Date } | { ok: false; error: string }
> {
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  const res = await db.execute(sql`
    select email, roles, expires_at, accepted_at
    from user_invite
    where token_hash = ${tokenHash}
    limit 1
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    email: string;
    roles: string[];
    expires_at: Date;
    accepted_at: Date | null;
  }>;

  const invite = rows[0];
  if (!invite) return { ok: false, error: 'not_found' };
  if (invite.accepted_at) return { ok: false, error: 'already_used' };
  if (new Date(invite.expires_at) < new Date()) return { ok: false, error: 'expired' };

  return {
    ok: true,
    email: invite.email,
    roles: invite.roles,
    expiresAt: new Date(invite.expires_at),
  };
}
