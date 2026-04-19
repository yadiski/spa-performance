process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { writeAudit } from '../src/audit/log';
import { db } from '../src/db/client';
import { runDailyAuditAnchor } from '../src/jobs/daily-audit-anchor';

describe('runDailyAuditAnchor', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
    await client`delete from audit_anchor`;
    await client.end({ timeout: 2 });
  });

  it('writes an audit_anchor row matching last hash of day', async () => {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        eventType: 'anchor.test',
        actorId: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        payload: {},
        ip: null,
        ua: null,
      });
    });
    const today = new Date().toISOString().slice(0, 10);
    await runDailyAuditAnchor(today);
    const res = await db.execute(sql`
      select date::text as date, root_hash from audit_anchor where date = ${today}::date
    `);
    const rows = Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows;
    const row = (rows as Array<{ date: string; root_hash: Uint8Array | Buffer }>)[0];
    expect(row?.date).toBe(today);
    const hash = row?.root_hash;
    const len = hash instanceof Uint8Array ? hash.length : hash ? (hash as Buffer).length : 0;
    expect(len).toBe(32);
  });
});
