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
import { runRetentionAuth } from '../src/jobs/retention-auth';

async function seedFailedAttempts(count: number, daysBack: number): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  for (let i = 0; i < count; i++) {
    await client`
      insert into auth_failed_attempt (email_tried, ip, occurred_at)
      values (
        'test@example.com',
        '127.0.0.1',
        now() - (${daysBack} || ' days')::interval
      )
    `;
  }
  await client.end({ timeout: 2 });
}

describe('runRetentionAuth', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table auth_failed_attempt`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('deletes old auth_failed_attempt rows beyond 90 days', async () => {
    // Seed 5 rows that are 100 days old (beyond cutoff)
    await seedFailedAttempts(5, 100);
    // Seed 3 rows that are recent (within cutoff)
    await seedFailedAttempts(3, 10);

    const result = await runRetentionAuth(db);

    expect(result.deleted).toBe(5);

    // Verify only recent rows remain
    const remaining = await db.execute(sql`select count(*) as cnt from auth_failed_attempt`);
    const rows = Array.isArray(remaining) ? remaining : [];
    const cnt = Number((rows[0] as { cnt: string })?.cnt ?? 0);
    expect(cnt).toBe(3);
  });

  it('writes a retention.auth.deleted audit event', async () => {
    await seedFailedAttempts(2, 100);

    await runRetentionAuth(db);

    const auditRows = await db.execute(sql`
      select event_type, payload from audit_log
      where event_type = 'retention.auth.deleted'
      limit 1
    `);
    const rows = Array.isArray(auditRows) ? auditRows : [];
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: { deleted: number } }).payload;
    expect(payload.deleted).toBe(2);
  });

  it('returns 0 deleted when no rows are beyond cutoff', async () => {
    await seedFailedAttempts(5, 10); // recent rows
    const result = await runRetentionAuth(db);
    expect(result.deleted).toBe(0);
  });
});
