/**
 * T33/T34/T35/T36/T37/T38/T39 — Onboarding + access review tests
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { Actor } from '../src/auth/middleware';
import { applyAccessReviewDecision, generateAccessReview } from '../src/compliance/access-review';
import { db } from '../src/db/client';
import * as queue from '../src/jobs/queue';
import { acceptInvite, createInvite, verifyInviteToken } from '../src/onboarding/invite';
import { acceptPasswordReset, initiatePasswordReset } from '../src/onboarding/password-reset';

// Mock pg-boss queue
spyOn(queue.boss, 'send').mockImplementation(async () => null as unknown as string);

const ADMIN_USER_ID = 'aa000000-0000-0000-0000-000000000001';
const ORG_ID = 'bb000000-0000-0000-0000-000000000001';

function mkAdminActor(userId: string = ADMIN_USER_ID): Actor {
  return {
    userId,
    staffId: null,
    roles: ['hra'] as Actor['roles'],
    email: `${userId}@test.local`,
    ip: null,
    ua: null,
  };
}

describe('onboarding — invite flow (T33)', () => {
  beforeAll(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`delete from user_invite where email like '%@invite-test.local'`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('createInvite — hra actor creates invite row + queues email', async () => {
    const actor = mkAdminActor();
    const result = await createInvite({
      db,
      actor,
      email: 'new-user@invite-test.local',
      roles: ['staff'],
      orgId: ORG_ID,
    });

    expect(result.inviteId).toBeTruthy();
    expect(result.token).toHaveLength(64); // 32 bytes hex
    expect(result.url).toContain('/invite/');

    // Check DB row
    const rowRes = await db.execute(sql`
      select id, email, roles, accepted_at from user_invite where id = ${result.inviteId}::uuid
    `);
    const rows = (
      Array.isArray(rowRes) ? rowRes : ((rowRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      id: string;
      email: string;
      roles: string[];
      accepted_at: Date | null;
    }>;
    expect(rows[0]?.email).toBe('new-user@invite-test.local');
    expect(rows[0]?.accepted_at).toBeNull();
  });

  it('createInvite — non-admin actor gets forbidden error', async () => {
    const actor: Actor = {
      userId: ADMIN_USER_ID,
      staffId: null,
      roles: ['staff'] as Actor['roles'],
      email: 'staff@test.local',
      ip: null,
      ua: null,
    };

    await expect(
      createInvite({ db, actor, email: 'x@invite-test.local', roles: ['staff'], orgId: ORG_ID }),
    ).rejects.toThrow(/forbidden/);
  });

  it('verifyInviteToken — returns invite details for valid token', async () => {
    const actor = mkAdminActor();
    const { token } = await createInvite({
      db,
      actor,
      email: 'verify-test@invite-test.local',
      roles: ['staff'],
      orgId: ORG_ID,
    });

    const result = await verifyInviteToken(db, token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email).toBe('verify-test@invite-test.local');
    expect(result.roles).toContain('staff');
  });

  it('verifyInviteToken — returns error for bogus token', async () => {
    const result = await verifyInviteToken(db, 'a'.repeat(64));
    expect(result.ok).toBe(false);
  });

  it('acceptInvite — creates user + marks invite accepted', async () => {
    const actor = mkAdminActor();
    const { token } = await createInvite({
      db,
      actor,
      email: 'accept-test@invite-test.local',
      roles: ['staff'],
      orgId: ORG_ID,
    });

    const result = await acceptInvite(db, { token, password: 'SecurePass123!' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBeTruthy();

    // User should exist
    const userRes = await db.execute(sql`
      select id from "user" where email = 'accept-test@invite-test.local' limit 1
    `);
    const userRows = (
      Array.isArray(userRes) ? userRes : ((userRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    expect(userRows[0]?.id).toBe(result.userId);

    // Invite should be marked as accepted
    const inviteRes = await db.execute(sql`
      select accepted_at from user_invite where token_hash = ${createHash('sha256').update(token, 'utf8').digest('hex')}
    `);
    const inviteRows = (
      Array.isArray(inviteRes) ? inviteRes : ((inviteRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ accepted_at: Date | null }>;
    expect(inviteRows[0]?.accepted_at).not.toBeNull();

    // Cleanup user
    await db.execute(sql`delete from "user" where id = ${result.userId}::uuid`);
  });

  it('acceptInvite — rejects short password', async () => {
    const actor = mkAdminActor();
    const { token } = await createInvite({
      db,
      actor,
      email: 'short-pw@invite-test.local',
      roles: ['staff'],
      orgId: ORG_ID,
    });

    const result = await acceptInvite(db, { token, password: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('12 characters');
  });

  it('acceptInvite — rejects already-accepted invite', async () => {
    const actor = mkAdminActor();
    const { token } = await createInvite({
      db,
      actor,
      email: 'double-accept@invite-test.local',
      roles: ['staff'],
      orgId: ORG_ID,
    });

    const first = await acceptInvite(db, { token, password: 'SecurePass456!' });
    expect(first.ok).toBe(true);

    const second = await acceptInvite(db, { token, password: 'SecurePass456!' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain('already been used');

    // Cleanup user
    if (first.ok) await db.execute(sql`delete from "user" where id = ${first.userId}::uuid`);
  });
});

describe('onboarding — password reset (T34)', () => {
  const TEST_EMAIL = 'pw-reset-test@invite-test.local';
  let testUserId: string | null = null;

  beforeAll(async () => {
    // Create a test user
    const userRes = await db.execute(sql`
      insert into "user" (email, name, email_verified, created_at, updated_at)
      values (${TEST_EMAIL}, 'Reset Test', false, now(), now())
      on conflict (email) do update set name = 'Reset Test'
      returning id
    `);
    const userRows = (
      Array.isArray(userRes) ? userRes : ((userRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    testUserId = userRows[0]?.id ?? null;

    // Clean old tokens
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`delete from password_reset_token where user_id = ${testUserId!}::uuid`;
    await client.end({ timeout: 2 });
  });

  it('initiatePasswordReset — silently ignores non-existent email', async () => {
    // Should not throw
    await expect(
      initiatePasswordReset(db, { email: 'nobody@example.invalid' }),
    ).resolves.toBeUndefined();
  });

  it('initiatePasswordReset — inserts token for existing user', async () => {
    await initiatePasswordReset(db, { email: TEST_EMAIL });

    const tokenRes = await db.execute(sql`
      select id, user_id, used_at from password_reset_token
      where user_id = ${testUserId!}::uuid
      order by created_at desc limit 1
    `);
    const tokenRows = (
      Array.isArray(tokenRes) ? tokenRes : ((tokenRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      id: string;
      user_id: string;
      used_at: Date | null;
    }>;
    expect(tokenRows[0]?.user_id).toBe(testUserId ?? undefined);
    expect(tokenRows[0]?.used_at).toBeNull();
  });

  it('acceptPasswordReset — rejects bogus token', async () => {
    const result = await acceptPasswordReset(db, {
      token: 'a'.repeat(64),
      newPassword: 'NewPass999!',
    });
    expect(result.ok).toBe(false);
  });

  it('acceptPasswordReset — rejects short password', async () => {
    const result = await acceptPasswordReset(db, { token: 'a'.repeat(64), newPassword: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('12 characters');
  });
});

describe('access review (T37/T38/T39)', () => {
  beforeAll(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`delete from access_review_cycle`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('generateAccessReview — creates cycle + items', async () => {
    const result = await generateAccessReview(db);
    expect(result.cycleId).toBeTruthy();
    expect(typeof result.itemCount).toBe('number');

    // Cycle should be in in_progress state
    const cycleRes = await db.execute(sql`
      select status from access_review_cycle where id = ${result.cycleId}::uuid
    `);
    const cycleRows = (
      Array.isArray(cycleRes) ? cycleRes : ((cycleRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ status: string }>;
    expect(cycleRows[0]?.status).toBe('in_progress');
  });

  it('applyAccessReviewDecision — approve', async () => {
    // Get latest cycle and its first item
    const cycleRes = await db.execute(sql`
      select id from access_review_cycle order by generated_at desc limit 1
    `);
    const cycleRows = (
      Array.isArray(cycleRes) ? cycleRes : ((cycleRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const cycleId = cycleRows[0]?.id;
    if (!cycleId) return; // no cycle

    const itemRes = await db.execute(sql`
      select id from access_review_item where cycle_id = ${cycleId}::uuid and decision is null limit 1
    `);
    const itemRows = (
      Array.isArray(itemRes) ? itemRes : ((itemRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const itemId = itemRows[0]?.id;
    if (!itemId) return; // no items

    await applyAccessReviewDecision(db, {
      itemId,
      decision: 'approved',
      actorUserId: ADMIN_USER_ID,
    });

    // Check decision was recorded
    const updatedRes = await db.execute(sql`
      select decision from access_review_item where id = ${itemId}::uuid
    `);
    const updatedRows = (
      Array.isArray(updatedRes) ? updatedRes : ((updatedRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ decision: string }>;
    expect(updatedRows[0]?.decision).toBe('approved');
  });

  it('applyAccessReviewDecision — cannot decide same item twice', async () => {
    const cycleRes = await db.execute(sql`
      select id from access_review_cycle order by generated_at desc limit 1
    `);
    const cycleRows = (
      Array.isArray(cycleRes) ? cycleRes : ((cycleRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const cycleId = cycleRows[0]?.id;
    if (!cycleId) return;

    // Get an already-decided item
    const itemRes = await db.execute(sql`
      select id from access_review_item where cycle_id = ${cycleId}::uuid and decision = 'approved' limit 1
    `);
    const itemRows = (
      Array.isArray(itemRes) ? itemRes : ((itemRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const itemId = itemRows[0]?.id;
    if (!itemId) return;

    await expect(
      applyAccessReviewDecision(db, {
        itemId,
        decision: 'deferred',
        actorUserId: ADMIN_USER_ID,
      }),
    ).rejects.toThrow(/Decision already recorded/);
  });
});
