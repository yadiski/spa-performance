process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterEach, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { writeAudit } from '../src/audit/log';
import { db } from '../src/db/client';
import { verifyRestoredState } from '../src/scripts/restore-drill';

const today = new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

afterEach(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table audit_log`;
  await client.end({ timeout: 2 });
});

describe('verifyRestoredState', () => {
  it('passes when audit chain is intact', async () => {
    // Write a clean audit event
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'test.restore_drill',
        actorId: null,
        actorRole: 'system',
        targetType: null,
        targetId: null,
        payload: { note: 'smoke test' },
        ip: null,
        ua: null,
      });
    });

    const result = await verifyRestoredState(thirtyDaysAgo, today);
    expect(result.ok).toBe(true);
  });

  it('fails when a bogus audit row is injected (hash mismatch)', async () => {
    // Write a valid audit event first
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'test.valid_event',
        actorId: null,
        actorRole: 'system',
        targetType: null,
        targetId: null,
        payload: { order: 1 },
        ip: null,
        ua: null,
      });
    });

    // Inject a tampered row directly (bypassing hash logic)
    // Use a zeroed prev_hash and zeroed hash so the chain breaks
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, prev_hash, hash, chain_root)
      values (
        now(),
        'test.tampered',
        null, 'system', null, null,
        '{"tampered":true}'::jsonb,
        decode('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
        decode('0000000000000000000000000000000000000000000000000000000000000002', 'hex'),
        decode('0000000000000000000000000000000000000000000000000000000000000002', 'hex')
      )
    `;
    await client.end({ timeout: 2 });

    const result = await verifyRestoredState(thirtyDaysAgo, today);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('should have failed');
    expect(result.failedId).toBeTruthy();
  });
});
