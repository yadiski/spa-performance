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
import { db } from '../src/db/client';
import { runRetentionExports } from '../src/jobs/retention-exports';
import * as r2 from '../src/storage/r2';

const r2DelSpy = spyOn(r2, 'del').mockResolvedValue(undefined);

afterAll(() => {
  r2DelSpy.mockRestore();
});

async function seedExportJob(
  status: string,
  completedDaysAgo: number | null,
  r2Key: string | null = null,
): Promise<string> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const orgId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000002';

  const completedAt =
    completedDaysAgo !== null ? `now() - (${completedDaysAgo} || ' days')::interval` : 'null';

  const res = await client.unsafe(`
    insert into export_job (kind, requested_by, org_id, status, r2_key, completed_at)
    values ('test_export', '${userId}', '${orgId}', '${status}', ${r2Key ? `'${r2Key}'` : 'null'}, ${completedAt})
    returning id
  `);
  await client.end({ timeout: 2 });
  return (res[0] as unknown as { id: string }).id;
}

describe('runRetentionExports', () => {
  beforeEach(async () => {
    r2DelSpy.mockClear();
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table export_job`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('marks completed export_job rows older than 1 year as expired', async () => {
    // Seed 2 old completed rows (400 days = > 1 year)
    await seedExportJob('completed', 400);
    await seedExportJob('completed', 400);
    // Seed 1 recent completed row (within cutoff)
    await seedExportJob('completed', 30);

    const result = await runRetentionExports(db);
    expect(result.expired).toBe(2);

    // Verify old rows are now expired
    const expiredRows = await db.execute(sql`
      select count(*) as cnt from export_job where status = 'expired'
    `);
    const rows = Array.isArray(expiredRows) ? expiredRows : [];
    expect(Number((rows[0] as { cnt: string }).cnt)).toBe(2);

    // Verify recent row is still completed
    const completedRows = await db.execute(sql`
      select count(*) as cnt from export_job where status = 'completed'
    `);
    const cRows = Array.isArray(completedRows) ? completedRows : [];
    expect(Number((cRows[0] as { cnt: string }).cnt)).toBe(1);
  });

  it('calls r2.del for rows with r2_key', async () => {
    await seedExportJob('completed', 400, 'exports/test-key-1.xlsx');

    const result = await runRetentionExports(db);
    expect(result.r2Deleted).toBe(1);
    expect(r2DelSpy).toHaveBeenCalledWith('exports/test-key-1.xlsx');
  });

  it('does not attempt r2 delete for rows without r2_key', async () => {
    await seedExportJob('completed', 400, null); // no r2_key

    await runRetentionExports(db);
    expect(r2DelSpy).not.toHaveBeenCalled();
  });

  it('writes an audit event', async () => {
    await seedExportJob('completed', 400);

    await runRetentionExports(db);

    const auditRows = await db.execute(sql`
      select event_type, payload from audit_log
      where event_type = 'retention.exports.expired'
      limit 1
    `);
    const rows = Array.isArray(auditRows) ? auditRows : [];
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: { expired: number } }).payload;
    expect(payload.expired).toBe(1);
  });
});
