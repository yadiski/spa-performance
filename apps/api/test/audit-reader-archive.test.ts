process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';
process.env.R2_ACCOUNT_ID ??= 'test-account';
process.env.R2_ACCESS_KEY_ID ??= 'test-key';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret';
process.env.R2_BUCKET ??= 'test-bucket';

import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readAudit } from '../src/audit/reader-archive';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import * as r2 from '../src/storage/r2';

// We will mock r2.get to return compressed JSONL
const r2GetSpy = spyOn(r2, 'get').mockImplementation(async (_key: string) => {
  // Returns empty compressed JSONL by default — tests can override mockReturnValueOnce
  return gzipSync(Buffer.from('', 'utf-8'));
});

afterAll(() => {
  r2GetSpy.mockRestore();
});

function makeJsonlGz(rows: object[]): Buffer {
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
  return gzipSync(Buffer.from(jsonl, 'utf-8'));
}

describe('readAudit', () => {
  beforeEach(async () => {
    r2GetSpy.mockClear();
    r2GetSpy.mockImplementation(async (_key: string) => gzipSync(Buffer.from('', 'utf-8')));

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
    await client`truncate table audit_archive_manifest`;
    await client.end({ timeout: 2 });
  });

  it('returns hot rows from audit_log for the given date range', async () => {
    // Insert some hot rows
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    for (let i = 0; i < 3; i++) {
      const hexVal = (i + 1).toString(16).padStart(64, '0');
      await client`
        insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
        values (
          now() - (${i} || ' hours')::interval,
          'test.hot.event',
          null, null, null, null, '{}'::jsonb, null, null,
          decode(repeat('00', 32), 'hex'),
          decode(${hexVal}, 'hex'),
          decode(${hexVal}, 'hex')
        )
      `;
    }
    await client.end({ timeout: 2 });

    const from = new Date(Date.now() - 2 * 86_400_000);
    const to = new Date(Date.now() + 86_400_000);

    const result = await readAudit(db, { from, to });
    expect(result.hot.length).toBe(3);
    expect(result.cold.length).toBe(0);
    expect(result.total).toBe(3);
    expect(result.capped).toBe(false);
    // r2.get should not have been called (no manifests)
    expect(r2GetSpy).not.toHaveBeenCalled();
  });

  it('returns cold rows from archived manifests', async () => {
    const from = new Date('2024-01-01T00:00:00Z');
    const to = new Date('2024-01-31T23:59:59Z');

    // Fake archive rows for January 2024
    const coldRows = [
      {
        id: '1001',
        ts: '2024-01-15T10:00:00.000Z',
        event_type: 'test.cold.event',
        actor_id: null,
        actor_role: null,
        target_type: null,
        target_id: 'target-abc',
        payload: { cold: true },
        ip: null,
        ua: null,
        prev_hash: '00'.repeat(32),
        hash: 'aa'.repeat(32),
        chain_root: 'aa'.repeat(32),
      },
      {
        id: '1002',
        ts: '2024-01-20T12:00:00.000Z',
        event_type: 'test.cold.event',
        actor_id: null,
        actor_role: null,
        target_type: null,
        target_id: null,
        payload: { cold: true },
        ip: null,
        ua: null,
        prev_hash: 'aa'.repeat(32),
        hash: 'bb'.repeat(32),
        chain_root: 'aa'.repeat(32),
      },
    ];

    // Mock r2.get to return compressed JSONL for this key
    r2GetSpy.mockResolvedValueOnce(makeJsonlGz(coldRows));

    // Insert manifest row
    await db.insert(s.auditArchiveManifest).values({
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      r2Key: 'audit-archive/2024-01.jsonl.gz',
      sha256: 'deadbeef'.padEnd(64, '0'),
      rowCount: 2,
    });

    const result = await readAudit(db, { from, to });
    expect(result.hot.length).toBe(0);
    expect(result.cold.length).toBe(2);
    expect(result.total).toBe(2);

    // Verify r2.get was called with the correct key
    expect(r2GetSpy).toHaveBeenCalledWith('audit-archive/2024-01.jsonl.gz');
  });

  it('filters cold rows by eventType', async () => {
    const from = new Date('2024-02-01T00:00:00Z');
    const to = new Date('2024-02-28T23:59:59Z');

    const coldRows = [
      {
        id: '2001',
        ts: '2024-02-10T10:00:00.000Z',
        event_type: 'matching.event',
        actor_id: null,
        actor_role: null,
        target_type: null,
        target_id: null,
        payload: {},
        ip: null,
        ua: null,
        prev_hash: '00'.repeat(32),
        hash: 'cc'.repeat(32),
        chain_root: 'cc'.repeat(32),
      },
      {
        id: '2002',
        ts: '2024-02-12T10:00:00.000Z',
        event_type: 'other.event',
        actor_id: null,
        actor_role: null,
        target_type: null,
        target_id: null,
        payload: {},
        ip: null,
        ua: null,
        prev_hash: 'cc'.repeat(32),
        hash: 'dd'.repeat(32),
        chain_root: 'cc'.repeat(32),
      },
    ];

    r2GetSpy.mockResolvedValueOnce(makeJsonlGz(coldRows));

    await db.insert(s.auditArchiveManifest).values({
      periodStart: '2024-02-01',
      periodEnd: '2024-02-28',
      r2Key: 'audit-archive/2024-02.jsonl.gz',
      sha256: 'aabb'.padEnd(64, '0'),
      rowCount: 2,
    });

    const result = await readAudit(db, { from, to, eventType: 'matching.event' });
    expect(result.cold.length).toBe(1);
    expect(result.cold[0]!.eventType).toBe('matching.event');
  });

  it('merges hot and cold rows and returns correct totals', async () => {
    // Insert 2 hot rows
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    for (let i = 0; i < 2; i++) {
      const hexVal = (i + 500).toString(16).padStart(64, '0');
      await client`
        insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
        values (
          now() - (${i} || ' minutes')::interval,
          'hot.event',
          null, null, null, null, '{}'::jsonb, null, null,
          decode(repeat('00', 32), 'hex'),
          decode(${hexVal}, 'hex'),
          decode(${hexVal}, 'hex')
        )
      `;
    }
    await client.end({ timeout: 2 });

    // And 3 cold rows from an old archive
    const from2024 = new Date('2024-03-01T00:00:00Z');
    const to2024 = new Date('2024-03-31T23:59:59Z');

    const coldRows = Array.from({ length: 3 }, (_, i) => ({
      id: String(3001 + i),
      ts: `2024-03-${10 + i}T10:00:00.000Z`,
      event_type: 'cold.event',
      actor_id: null,
      actor_role: null,
      target_type: null,
      target_id: null,
      payload: {},
      ip: null,
      ua: null,
      prev_hash: '00'.repeat(32),
      hash: `ee${i}`.padEnd(64, '0'),
      chain_root: '00'.repeat(32),
    }));

    r2GetSpy.mockResolvedValueOnce(makeJsonlGz(coldRows));

    await db.insert(s.auditArchiveManifest).values({
      periodStart: '2024-03-01',
      periodEnd: '2024-03-31',
      r2Key: 'audit-archive/2024-03.jsonl.gz',
      sha256: '1234'.padEnd(64, '0'),
      rowCount: 3,
    });

    // Query spanning today AND the old archive (for cold rows, use their specific range)
    const resultCold = await readAudit(db, { from: from2024, to: to2024 });
    expect(resultCold.cold.length).toBe(3);
    expect(resultCold.hot.length).toBe(0); // no hot rows in that date range

    const fromNow = new Date(Date.now() - 3600_000);
    const toNow = new Date(Date.now() + 3600_000);
    const resultHot = await readAudit(db, { from: fromNow, to: toNow });
    expect(resultHot.hot.length).toBe(2);
    expect(resultHot.total).toBe(2);
  });
});
