process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import { runRetentionAiCache } from '../src/jobs/retention-ai-cache';

async function seedAiCacheRow(daysBack: number): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`
    insert into ai_cache (feature, scope_key, content_hash, model, output, created_at)
    values (
      'test_feature',
      'test_scope',
      'hash_' || gen_random_uuid()::text,
      'test-model',
      '{"result": "ok"}'::jsonb,
      now() - (${daysBack} || ' days')::interval
    )
  `;
  await client.end({ timeout: 2 });
}

describe('runRetentionAiCache', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table ai_cache`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('returns 0 deleted when no rows are beyond 7-year cutoff (typical case)', async () => {
    // Seed recent rows — these should never be deleted
    await seedAiCacheRow(10);
    await seedAiCacheRow(365);

    const result = await runRetentionAiCache(db);
    expect(result.deleted).toBe(0);

    const remaining = await db.execute(sql`select count(*) as cnt from ai_cache`);
    const rows = Array.isArray(remaining) ? remaining : [];
    expect(Number((rows[0] as { cnt: string }).cnt)).toBe(2);
  });

  it('deletes rows older than 7 years when they exist', async () => {
    // We simulate a row older than 7 years (2556 days = ~7 years)
    const sevenYearsAndOneDayInDays = 365 * 7 + 1;
    await seedAiCacheRow(sevenYearsAndOneDayInDays);
    await seedAiCacheRow(10); // recent row — should not be deleted

    const result = await runRetentionAiCache(db);
    expect(result.deleted).toBe(1);

    const remaining = await db.execute(sql`select count(*) as cnt from ai_cache`);
    const rows = Array.isArray(remaining) ? remaining : [];
    expect(Number((rows[0] as { cnt: string }).cnt)).toBe(1);
  });

  it('writes a retention.ai_cache.deleted audit event', async () => {
    const sevenYearsAndOneDayInDays = 365 * 7 + 1;
    await seedAiCacheRow(sevenYearsAndOneDayInDays);

    await runRetentionAiCache(db);

    const auditRows = await db.execute(sql`
      select event_type, payload from audit_log
      where event_type = 'retention.ai_cache.deleted'
      limit 1
    `);
    const rows = Array.isArray(auditRows) ? auditRows : [];
    expect(rows.length).toBe(1);
  });
});
