process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it, beforeEach } from 'bun:test';
import postgres from 'postgres';
import { db } from '../src/db/client';
import { writeAudit } from '../src/audit/log';
import { verifyChain } from '../src/audit/verifier';

describe('audit log', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    // audit_log has no FK dependencies that force cascades, but auth_log is isolated
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('writes a chain and verifies OK', async () => {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'test.one',
        actorId: null, actorRole: null, targetType: null, targetId: null,
        payload: { a: 1 }, ip: null, ua: null,
      });
      await writeAudit(tx, {
        eventType: 'test.two',
        actorId: null, actorRole: null, targetType: null, targetId: null,
        payload: { b: 2 }, ip: null, ua: null,
      });
    });
    const today = new Date().toISOString().slice(0, 10);
    const result = await verifyChain(db, today, today);
    expect(result.ok).toBe(true);
  });

  it('rejects UPDATE on audit_log', async () => {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'test.trigger',
        actorId: null, actorRole: null, targetType: null, targetId: null,
        payload: {}, ip: null, ua: null,
      });
    });
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    let threw = false;
    let message = '';
    try {
      await client`update audit_log set event_type = 'x'`;
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    } finally {
      await client.end({ timeout: 2 });
    }
    expect(threw).toBe(true);
    expect(message).toMatch(/append-only/);
  });
});
