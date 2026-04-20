/**
 * T8 — Impersonation tests
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  endImpersonation,
  getActiveImpersonation,
  startImpersonation,
} from '../src/auth/impersonation';
import type { Actor } from '../src/auth/middleware';
import { db } from '../src/db/client';
import * as queue from '../src/jobs/queue';

// Mock pg-boss queue so we don't need real job queue
spyOn(queue.boss, 'send').mockImplementation(async () => null as unknown as string);

const IT_ADMIN_USER_ID = '20000000-0000-0000-0000-000000000001';
const TARGET_USER_ID = '20000000-0000-0000-0000-000000000002';
const STAFF_ACTOR_USER_ID = '20000000-0000-0000-0000-000000000003';

function mkActor(userId: string, roles: string[] = ['it_admin']): Actor {
  return {
    userId,
    staffId: null,
    roles: roles as Actor['roles'],
    email: `${userId}@test.local`,
    ip: null,
    ua: null,
  };
}

describe('impersonation', () => {
  beforeAll(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`delete from impersonation_session where impersonator_user_id = ${IT_ADMIN_USER_ID}::uuid`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('IT admin starts impersonation — row created + audit written', async () => {
    const actor = mkActor(IT_ADMIN_USER_ID, ['it_admin']);
    const result = await startImpersonation(db, {
      actor,
      targetUserId: TARGET_USER_ID,
      reason: 'Investigating reported issue',
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.sessionId).toBeTruthy();
    expect(result.expiresAt).toBeInstanceOf(Date);

    // Check DB row
    const rowRes = await db.execute(sql`
      select id, target_user_id, reason, expires_at, ended_at
      from impersonation_session
      where id = ${result.sessionId}::uuid
    `);
    const rows = (
      Array.isArray(rowRes) ? rowRes : ((rowRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      id: string;
      target_user_id: string;
      reason: string;
      expires_at: Date;
      ended_at: Date | null;
    }>;
    expect(rows[0]?.target_user_id).toBe(TARGET_USER_ID);
    expect(rows[0]?.reason).toBe('Investigating reported issue');
    expect(rows[0]?.ended_at).toBeNull();

    // Check audit log
    const auditRes = await db.execute(sql`
      select event_type, actor_id, target_id
      from audit_log
      where event_type = 'impersonation.start'
        and actor_id = ${IT_ADMIN_USER_ID}
      order by id desc
      limit 1
    `);
    const auditRows = (
      Array.isArray(auditRes) ? auditRes : ((auditRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string; actor_id: string; target_id: string }>;
    expect(auditRows[0]?.event_type).toBe('impersonation.start');
    expect(auditRows[0]?.actor_id).toBe(IT_ADMIN_USER_ID);
  });

  it('non-IT-admin gets error', async () => {
    const actor = mkActor(STAFF_ACTOR_USER_ID, ['staff']);
    const result = await startImpersonation(db, {
      actor,
      targetUserId: TARGET_USER_ID,
      reason: 'Should fail',
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/forbidden/);
    }
  });

  it('duration > 60 minutes is rejected', async () => {
    const actor = mkActor(IT_ADMIN_USER_ID, ['it_admin']);
    const result = await startImpersonation(db, {
      actor,
      targetUserId: TARGET_USER_ID,
      reason: 'Should be rejected',
      durationMin: 61,
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/maximum/);
    }
  });

  it('expired impersonation not returned by getActiveImpersonation', async () => {
    // Insert an expired session directly
    await db.execute(sql`
      insert into impersonation_session (impersonator_user_id, target_user_id, reason, started_at, expires_at)
      values (
        ${IT_ADMIN_USER_ID}::uuid,
        ${TARGET_USER_ID}::uuid,
        'expired test',
        now() - interval '2 hours',
        now() - interval '1 hour'
      )
    `);

    // Clean up any active sessions first
    await db.execute(sql`
      update impersonation_session
      set ended_at = now()
      where impersonator_user_id = ${IT_ADMIN_USER_ID}::uuid
        and ended_at is null
        and expires_at > now()
    `);

    const active = await getActiveImpersonation(db, IT_ADMIN_USER_ID);
    expect(active).toBeNull();
  });

  it('endImpersonation writes end audit row', async () => {
    const actor = mkActor(IT_ADMIN_USER_ID, ['it_admin']);

    // Start a fresh session
    const startResult = await startImpersonation(db, {
      actor,
      targetUserId: TARGET_USER_ID,
      reason: 'End test',
      durationMin: 15,
    });

    expect('error' in startResult).toBe(false);
    if ('error' in startResult) return;

    await endImpersonation(db, {
      actor,
      sessionId: startResult.sessionId,
      reason: 'completed',
    });

    // Check that the session has ended_at set
    const rowRes = await db.execute(sql`
      select ended_at, ended_reason
      from impersonation_session
      where id = ${startResult.sessionId}::uuid
    `);
    const rows = (
      Array.isArray(rowRes) ? rowRes : ((rowRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ ended_at: Date | null; ended_reason: string | null }>;
    expect(rows[0]?.ended_at).not.toBeNull();
    expect(rows[0]?.ended_reason).toBe('completed');

    // Check audit log for impersonation.end
    const auditRes = await db.execute(sql`
      select event_type
      from audit_log
      where event_type = 'impersonation.end'
        and actor_id = ${IT_ADMIN_USER_ID}
      order by id desc
      limit 1
    `);
    const auditRows = (
      Array.isArray(auditRes) ? auditRes : ((auditRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string }>;
    expect(auditRows[0]?.event_type).toBe('impersonation.end');
  });

  it('getActiveImpersonation returns running session', async () => {
    const actor = mkActor(IT_ADMIN_USER_ID, ['it_admin']);

    // Clean up existing sessions
    await db.execute(sql`
      update impersonation_session
      set ended_at = now()
      where impersonator_user_id = ${IT_ADMIN_USER_ID}::uuid
        and ended_at is null
    `);

    const startResult = await startImpersonation(db, {
      actor,
      targetUserId: TARGET_USER_ID,
      reason: 'Active session test',
      durationMin: 15,
    });

    expect('error' in startResult).toBe(false);
    if ('error' in startResult) return;

    const active = await getActiveImpersonation(db, IT_ADMIN_USER_ID);
    expect(active).not.toBeNull();
    expect(active?.sessionId).toBe(startResult.sessionId);
    expect(active?.targetUserId).toBe(TARGET_USER_ID);
  });
});
