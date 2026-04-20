/**
 * T6 — Account lockout tests
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  LOCKOUT_DURATION_MIN,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MIN,
  checkAndMaybeLock,
  isLocked,
  recordFailedAttempt,
  unlockAccount,
} from '../src/auth/lockout';
import { db } from '../src/db/client';

const TEST_USER_ID = '10000000-0000-0000-0000-000000000001';
const ACTOR_USER_ID = '10000000-0000-0000-0000-000000000002';

describe('account lockout', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`delete from account_lockout where user_id = ${TEST_USER_ID}::uuid`;
    await client`delete from auth_failed_attempt where user_id = ${TEST_USER_ID}::uuid`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  afterEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`delete from account_lockout where user_id = ${TEST_USER_ID}::uuid`;
    await client`delete from auth_failed_attempt where user_id = ${TEST_USER_ID}::uuid`;
    await client.end({ timeout: 2 });
  });

  it('is not locked initially', async () => {
    const locked = await isLocked(db, TEST_USER_ID);
    expect(locked).toBe(false);
  });

  it('10 failed attempts within window triggers lockout', async () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await recordFailedAttempt(db, {
        userId: TEST_USER_ID,
        email: 'test@lockout.local',
      });
    }

    const locked = await isLocked(db, TEST_USER_ID);
    expect(locked).toBe(true);
  });

  it('checkAndMaybeLock returns locked after threshold', async () => {
    // Insert threshold attempts directly
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await db.execute(sql`
        insert into auth_failed_attempt (user_id, email_tried, occurred_at)
        values (${TEST_USER_ID}::uuid, 'test@lockout.local', now())
      `);
    }

    const result = await checkAndMaybeLock(db, TEST_USER_ID);
    expect(result.locked).toBe(true);
    expect(result.until).toBeDefined();
  });

  it('attempts older than window are not counted', async () => {
    // Insert old attempts (beyond LOCKOUT_WINDOW_MIN)
    const oldTime = new Date(Date.now() - (LOCKOUT_WINDOW_MIN + 5) * 60 * 1000);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await db.execute(sql`
        insert into auth_failed_attempt (user_id, email_tried, occurred_at)
        values (${TEST_USER_ID}::uuid, 'test@lockout.local', ${oldTime.toISOString()}::timestamptz)
      `);
    }

    const result = await checkAndMaybeLock(db, TEST_USER_ID);
    expect(result.locked).toBe(false);
  });

  it('11th attempt is blocked when account is locked', async () => {
    // Lock the account first
    const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MIN * 60 * 1000);
    await db.execute(sql`
      insert into account_lockout (user_id, locked_until, locked_by_system)
      values (${TEST_USER_ID}::uuid, ${lockedUntil.toISOString()}::timestamptz, true)
    `);

    const locked = await isLocked(db, TEST_USER_ID);
    expect(locked).toBe(true);

    // checkAndMaybeLock should return locked immediately without counting
    const result = await checkAndMaybeLock(db, TEST_USER_ID);
    expect(result.locked).toBe(true);
  });

  it('lock expires after 30 minutes (simulated via expired lock row)', async () => {
    // Insert a lockout that has already expired
    const pastTime = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    await db.execute(sql`
      insert into account_lockout (user_id, locked_at, locked_until, locked_by_system)
      values (${TEST_USER_ID}::uuid, now(), ${pastTime.toISOString()}::timestamptz, true)
    `);

    const locked = await isLocked(db, TEST_USER_ID);
    expect(locked).toBe(false);
  });

  it('unlockAccount removes lockout row and writes audit event', async () => {
    // Lock the account
    const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MIN * 60 * 1000);
    await db.execute(sql`
      insert into account_lockout (user_id, locked_until, locked_by_system)
      values (${TEST_USER_ID}::uuid, ${lockedUntil.toISOString()}::timestamptz, true)
    `);

    expect(await isLocked(db, TEST_USER_ID)).toBe(true);

    await unlockAccount(db, {
      userId: TEST_USER_ID,
      actorUserId: ACTOR_USER_ID,
      reason: 'Manual unlock by IT admin',
    });

    expect(await isLocked(db, TEST_USER_ID)).toBe(false);

    // Check audit log
    const auditRes = await db.execute(sql`
      select event_type, actor_id, target_id, payload
      from audit_log
      where event_type = 'auth.account.unlocked'
        and target_id = ${TEST_USER_ID}
      order by id desc
      limit 1
    `);
    const auditRows = (
      Array.isArray(auditRes) ? auditRes : ((auditRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string; actor_id: string; target_id: string; payload: unknown }>;
    expect(auditRows[0]?.event_type).toBe('auth.account.unlocked');
    expect(auditRows[0]?.actor_id).toBe(ACTOR_USER_ID);
  });
});

describe('lockout admin unlock endpoint', () => {
  it('returns 401 without auth', async () => {
    const { app } = await import('../src/http/app');
    const res = await app.request('/api/v1/admin/auth/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: TEST_USER_ID, reason: 'test' }),
    });
    expect(res.status).toBe(401);
  });
});
