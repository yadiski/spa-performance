import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { type BudgetConfig, DEFAULT_BUDGET, checkBudget, recordUsage } from '../src/ai/core/budget';
import { db } from '../src/db/client';

const TEST_ORG_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table ai_cache, ai_usage_daily, ai_rate_limit`;
  await client.end({ timeout: 2 });
});

describe('checkBudget', () => {
  it('allows a fresh org with no usage', async () => {
    const result = await checkBudget({
      db,
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      estimatedTokens: 1000,
      config: DEFAULT_BUDGET,
    });
    expect(result.ok).toBe(true);
  });

  it('blocks when org daily cap is exhausted', async () => {
    // Seed usage that hits the cap
    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      VALUES (${TEST_ORG_ID}::uuid, ${today}::date, 150000, 60000, 100)
    `;
    await client.end({ timeout: 2 });

    const result = await checkBudget({
      db,
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      estimatedTokens: 1000,
      config: { dailyOrgTokenCap: 200_000, userHourRequestCap: 20 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('org_daily_cap_exhausted');
    }
  });

  it('allows when usage is just under cap', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      VALUES (${TEST_ORG_ID}::uuid, ${today}::date, 100000, 99000, 50)
    `;
    await client.end({ timeout: 2 });

    const result = await checkBudget({
      db,
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      estimatedTokens: 999, // 100000 + 99000 + 999 = 199999 < 200000
      config: { dailyOrgTokenCap: 200_000, userHourRequestCap: 20 },
    });

    expect(result.ok).toBe(true);
  });

  it('blocks when user hour rate limit is exhausted', async () => {
    const bucketStart = new Date();
    bucketStart.setMinutes(0, 0, 0);
    const bucketIso = bucketStart.toISOString();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_rate_limit (user_id, bucket_start, requests)
      VALUES (${TEST_USER_ID}::uuid, ${bucketIso}::timestamptz, 20)
    `;
    await client.end({ timeout: 2 });

    const result = await checkBudget({
      db,
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      estimatedTokens: 100,
      config: { dailyOrgTokenCap: 200_000, userHourRequestCap: 20 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('user_hour_rate_limit');
    }
  });
});

describe('recordUsage', () => {
  it('upserts ai_usage_daily on first call', async () => {
    await recordUsage(db, {
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      promptTokens: 100,
      completionTokens: 50,
    });

    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const rows = await client`
      SELECT prompt_tokens, completion_tokens, requests
      FROM ai_usage_daily
      WHERE org_id = ${TEST_ORG_ID}::uuid AND date = ${today}::date
    `;
    await client.end({ timeout: 2 });

    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.prompt_tokens)).toBe(100);
    expect(Number(rows[0]!.completion_tokens)).toBe(50);
    expect(Number(rows[0]!.requests)).toBe(1);
  });

  it('accumulates usage across two calls', async () => {
    await recordUsage(db, {
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      promptTokens: 100,
      completionTokens: 50,
    });
    await recordUsage(db, {
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      promptTokens: 200,
      completionTokens: 80,
    });

    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const rows = await client`
      SELECT prompt_tokens, completion_tokens, requests
      FROM ai_usage_daily
      WHERE org_id = ${TEST_ORG_ID}::uuid AND date = ${today}::date
    `;
    await client.end({ timeout: 2 });

    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.prompt_tokens)).toBe(300);
    expect(Number(rows[0]!.completion_tokens)).toBe(130);
    expect(Number(rows[0]!.requests)).toBe(2);
  });

  it('upserts ai_rate_limit on first call', async () => {
    await recordUsage(db, {
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      promptTokens: 10,
      completionTokens: 5,
    });

    const bucketStart = new Date();
    bucketStart.setMinutes(0, 0, 0);
    const bucketIso = bucketStart.toISOString();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const rows = await client`
      SELECT requests
      FROM ai_rate_limit
      WHERE user_id = ${TEST_USER_ID}::uuid AND bucket_start = ${bucketIso}::timestamptz
    `;
    await client.end({ timeout: 2 });

    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.requests)).toBe(1);
  });

  it('increments rate limit requests across two calls', async () => {
    await recordUsage(db, {
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      promptTokens: 10,
      completionTokens: 5,
    });
    await recordUsage(db, {
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      promptTokens: 20,
      completionTokens: 10,
    });

    const bucketStart = new Date();
    bucketStart.setMinutes(0, 0, 0);
    const bucketIso = bucketStart.toISOString();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const rows = await client`
      SELECT requests
      FROM ai_rate_limit
      WHERE user_id = ${TEST_USER_ID}::uuid AND bucket_start = ${bucketIso}::timestamptz
    `;
    await client.end({ timeout: 2 });

    expect(Number(rows[0]!.requests)).toBe(2);
    await client.end({ timeout: 2 }).catch(() => {});
  });
});
