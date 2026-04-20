/**
 * T10 — MFA recovery tests
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { consumeRecoveryCode, generateRecoveryCodes } from '../src/auth/mfa-recovery';
import { db } from '../src/db/client';

const TEST_USER_ID = '30000000-0000-0000-0000-000000000001';

describe('MFA recovery codes', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`delete from mfa_recovery_code where user_id = ${TEST_USER_ID}::uuid`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('generateRecoveryCodes returns 10 unique codes', async () => {
    const codes = await generateRecoveryCodes(db, TEST_USER_ID);
    expect(codes).toHaveLength(10);
    const unique = new Set(codes);
    expect(unique.size).toBe(10);
  });

  it('codes have format XXXX-XXXX-XXXX (3 segments of 4)', async () => {
    const codes = await generateRecoveryCodes(db, TEST_USER_ID);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
  });

  it('generateRecoveryCodes stores hashes (not plain codes) in DB', async () => {
    const codes = await generateRecoveryCodes(db, TEST_USER_ID);

    const dbRes = await db.execute(sql`
      select code_hash from mfa_recovery_code
      where user_id = ${TEST_USER_ID}::uuid
        and used_at is null
    `);
    const rows = (
      Array.isArray(dbRes) ? dbRes : ((dbRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ code_hash: string }>;

    expect(rows.length).toBe(10);
    // Verify none of the stored values equal the plain codes
    for (const code of codes) {
      const match = rows.find((r) => r.code_hash === code);
      expect(match).toBeUndefined();
    }
  });

  it('consumeRecoveryCode succeeds with valid code', async () => {
    const codes = await generateRecoveryCodes(db, TEST_USER_ID);
    const result = await consumeRecoveryCode(db, TEST_USER_ID, codes[0]!);
    expect(result.ok).toBe(true);
  });

  it('consumeRecoveryCode marks code as used', async () => {
    const codes = await generateRecoveryCodes(db, TEST_USER_ID);
    await consumeRecoveryCode(db, TEST_USER_ID, codes[1]!);

    // Second use should fail
    const result2 = await consumeRecoveryCode(db, TEST_USER_ID, codes[1]!);
    expect(result2.ok).toBe(false);
  });

  it('consumeRecoveryCode fails with invalid code', async () => {
    await generateRecoveryCodes(db, TEST_USER_ID);
    const result = await consumeRecoveryCode(db, TEST_USER_ID, 'FAKE-CODE-TEST');
    expect(result.ok).toBe(false);
  });

  it('consumeRecoveryCode writes audit event on success', async () => {
    const codes = await generateRecoveryCodes(db, TEST_USER_ID);
    await consumeRecoveryCode(db, TEST_USER_ID, codes[2]!);

    const auditRes = await db.execute(sql`
      select event_type, actor_id
      from audit_log
      where event_type = 'auth.mfa.recovery_used'
        and actor_id = ${TEST_USER_ID}
      order by id desc
      limit 1
    `);
    const auditRows = (
      Array.isArray(auditRes) ? auditRes : ((auditRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ event_type: string; actor_id: string }>;
    expect(auditRows[0]?.event_type).toBe('auth.mfa.recovery_used');
  });

  it('generateRecoveryCodes replaces old unused codes', async () => {
    const codes1 = await generateRecoveryCodes(db, TEST_USER_ID);
    const codes2 = await generateRecoveryCodes(db, TEST_USER_ID);

    // Old codes should no longer work
    const result = await consumeRecoveryCode(db, TEST_USER_ID, codes1[0]!);
    expect(result.ok).toBe(false);

    // New codes should work
    const result2 = await consumeRecoveryCode(db, TEST_USER_ID, codes2[0]!);
    expect(result2.ok).toBe(true);
  });
});

describe('MFA recovery route', () => {
  it('POST /api/v1/auth/mfa-recover with unknown email returns 401', async () => {
    const { app } = await import('../src/http/app');
    const res = await app.request('/api/v1/auth/mfa-recover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@example.com',
        recoveryCode: 'FAKE-CODE-0001',
      }),
    });
    expect(res.status).toBe(401);
  });
});
