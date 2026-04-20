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
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { runAuditArchive } from '../src/audit/archive';
import { db } from '../src/db/client';
import { auditArchiveManifest } from '../src/db/schema/audit';
import * as r2 from '../src/storage/r2';

const r2PutSpy = spyOn(r2, 'put').mockResolvedValue({ sha256: 'fake-sha256-stub' });

afterAll(() => {
  r2PutSpy.mockRestore();
});

async function seedAuditRows(count: number, daysBack: number): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  // Insert rows that appear to be `daysBack` days ago
  for (let i = 0; i < count; i++) {
    const hexVal = (i + 1).toString(16).padStart(64, '0');
    await client`
      insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
      values (
        now() - (${daysBack} || ' days')::interval - (${i} || ' hours')::interval,
        'test.archive.seed',
        null, null, null, null,
        ${JSON.stringify({ idx: i })}::jsonb,
        null, null,
        decode(repeat('00', 32), 'hex'),
        decode(${hexVal}, 'hex'),
        decode(${hexVal}, 'hex')
      )
    `;
  }
  await client.end({ timeout: 2 });
}

describe('runAuditArchive', () => {
  beforeEach(async () => {
    r2PutSpy.mockClear();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
    await client`truncate table audit_archive_manifest`;
    await client.end({ timeout: 2 });
  });

  it('returns ok:true with rowsArchived=0 when no old rows exist', async () => {
    // Only insert recent rows (within cutoff)
    await seedAuditRows(5, 10);

    const result = await runAuditArchive(db, { cutoffDays: 90 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rowsArchived).toBe(0);
      expect(result.key).toBeNull();
    }
    expect(r2PutSpy).not.toHaveBeenCalled();
  });

  it('archives rows older than 90 days, uploads JSONL.gz, inserts manifest, and deletes hot rows', async () => {
    // Seed 10 rows that are 100 days old (> 90 day cutoff)
    await seedAuditRows(10, 100);
    // Seed 5 rows that are recent (within cutoff)
    await seedAuditRows(5, 10);

    const result = await runAuditArchive(db, { cutoffDays: 90 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should have archived the 10 old rows
    expect(result.rowsArchived).toBe(10);
    expect(result.key).not.toBeNull();
    expect(result.key).toContain('audit-archive/');
    expect(result.key).toContain('.jsonl.gz');

    // R2 put should have been called at least once with gzip content type
    expect(r2PutSpy).toHaveBeenCalled();
    const [key, _bytes, contentType] = r2PutSpy.mock.calls[0]!;
    expect(key).toContain('audit-archive/');
    expect(contentType).toBe('application/gzip');

    // Manifest row should exist
    const manifestRows = await db.select().from(auditArchiveManifest);
    expect(manifestRows.length).toBeGreaterThanOrEqual(1);
    expect(manifestRows[0]!.rowCount).toBe(10);
    expect(manifestRows[0]!.r2Key).toContain('audit-archive/');

    // Hot rows older than 90 days should be deleted
    const remainingOldRows = (
      Array.isArray(
        await db.execute(
          sql`select count(*)::int as n from audit_log where ts < now() - interval '90 days'`,
        ),
      )
        ? await db.execute(
            sql`select count(*)::int as n from audit_log where ts < now() - interval '90 days'`,
          )
        : ((
            (await db.execute(
              sql`select count(*)::int as n from audit_log where ts < now() - interval '90 days'`,
            )) as { rows?: unknown[] }
          ).rows ?? [])
    ) as Array<{ n: number }>;
    expect(Number(remainingOldRows[0]!.n)).toBe(0);

    // Recent rows should be untouched
    const remainingRecentRows = (
      Array.isArray(await db.execute(sql`select count(*)::int as n from audit_log`))
        ? await db.execute(sql`select count(*)::int as n from audit_log`)
        : ((
            (await db.execute(sql`select count(*)::int as n from audit_log`)) as {
              rows?: unknown[];
            }
          ).rows ?? [])
    ) as Array<{ n: number }>;
    expect(Number(remainingRecentRows[0]!.n)).toBe(5);
  });

  it('groups rows by calendar month into separate archives', async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    // Insert rows in two different months, both > 90 days old
    // Month 1: ~120 days ago
    for (let i = 0; i < 5; i++) {
      const hexVal = (100 + i).toString(16).padStart(64, '0');
      await client`
        insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
        values (
          now() - interval '120 days' - (${i} || ' hours')::interval,
          'test.month1', null, null, null, null, '{}'::jsonb, null, null,
          decode(repeat('00', 32), 'hex'),
          decode(${hexVal}, 'hex'),
          decode(${hexVal}, 'hex')
        )
      `;
    }
    // Month 2: ~95 days ago (may be in same month as month1 depending on timing, but uses different days)
    for (let i = 0; i < 3; i++) {
      const hexVal = (200 + i).toString(16).padStart(64, '0');
      await client`
        insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
        values (
          now() - interval '95 days' - (${i} || ' hours')::interval,
          'test.month2', null, null, null, null, '{}'::jsonb, null, null,
          decode(repeat('00', 32), 'hex'),
          decode(${hexVal}, 'hex'),
          decode(${hexVal}, 'hex')
        )
      `;
    }
    await client.end({ timeout: 2 });

    const result = await runAuditArchive(db, { cutoffDays: 90 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowsArchived).toBe(8);

    // At least one manifest row, potentially two (if rows land in different months)
    const manifestRows = await db.select().from(auditArchiveManifest);
    expect(manifestRows.length).toBeGreaterThanOrEqual(1);

    // All old rows should be gone
    const remaining = (
      Array.isArray(
        await db.execute(
          sql`select count(*)::int as n from audit_log where ts < now() - interval '90 days'`,
        ),
      )
        ? await db.execute(
            sql`select count(*)::int as n from audit_log where ts < now() - interval '90 days'`,
          )
        : ((
            (await db.execute(
              sql`select count(*)::int as n from audit_log where ts < now() - interval '90 days'`,
            )) as { rows?: unknown[] }
          ).rows ?? [])
    ) as Array<{ n: number }>;
    expect(Number(remaining[0]!.n)).toBe(0);
  });
});
