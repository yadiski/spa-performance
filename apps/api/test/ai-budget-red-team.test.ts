/**
 * T39 — Budget guard red-team
 *
 * Scenarios:
 *   1. Exceed org daily cap → budget_exhausted + audit row
 *   2. Exceed user hour rate limit → rate_limited + appropriate error
 *   3. Cache hit bypasses budget check — cached result returned even when cap is exhausted
 *   4. Advisory lock stampede — two parallel calls, only one proceeds, second gets cache
 */

import './setup';
import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { z } from 'zod';
import type { BudgetConfig } from '../src/ai/core/budget';
import { dispatch } from '../src/ai/core/dispatch';
import * as openrouterMod from '../src/ai/core/openrouter';
import { db } from '../src/db/client';

// ── Spy setup ─────────────────────────────────────────────────────────────────

const mockCallOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(async () => ({
  content: { result: 'mocked-budget-test' },
  promptTokens: 100,
  completionTokens: 50,
  model: 'openai/gpt-4o-mini',
}));

afterAll(() => {
  mockCallOpenRouter.mockRestore();
});

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ORG_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const testActor = {
  userId: USER_ID,
  orgId: ORG_ID,
  staffId: null,
  roles: ['hra'],
};

const testSchema = z.object({ result: z.string() }).passthrough();
const testJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: { result: { type: 'string' } },
  required: ['result'],
};

const TIGHT_BUDGET: BudgetConfig = {
  dailyOrgTokenCap: 200_000,
  userHourRequestCap: 20,
};

const GENEROUS_BUDGET: BudgetConfig = {
  dailyOrgTokenCap: 10_000_000,
  userHourRequestCap: 1000,
};

type TestInput = { key: string };

function makeInput(
  overrides: { scopeKey?: string; budgetConfig?: BudgetConfig; key?: string } = {},
) {
  return {
    db,
    actor: testActor,
    feature: 'budget_redteam',
    scopeKey: overrides.scopeKey ?? `org:${ORG_ID}|key:${overrides.key ?? 'test'}`,
    input: { key: overrides.key ?? 'test-input' } as TestInput,
    model: 'openai/gpt-4o-mini',
    buildMessages: (inp: TestInput) => [
      { role: 'system' as const, content: 'You are helpful.' },
      { role: 'user' as const, content: inp.key },
    ],
    responseSchema: testSchema,
    jsonSchema: testJsonSchema,
    budgetConfig: overrides.budgetConfig ?? TIGHT_BUDGET,
  };
}

function dbRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

beforeEach(async () => {
  mockCallOpenRouter.mockClear();
  mockCallOpenRouter.mockImplementation(async () => ({
    content: { result: 'mocked-budget-test' },
    promptTokens: 100,
    completionTokens: 50,
    model: 'openai/gpt-4o-mini',
  }));

  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table ai_cache, ai_usage_daily, ai_rate_limit, audit_log`;
  await client.end({ timeout: 2 });
});

// ── Scenario 1: Exceed org daily cap ─────────────────────────────────────────

describe('T39 Scenario 1: exceed org daily cap → budget_exhausted + audit row', () => {
  it('returns budget_exhausted error when daily org token cap is exceeded', async () => {
    // Prime ai_usage_daily beyond the cap (200_000)
    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      VALUES (${ORG_ID}::uuid, ${today}::date, 150_000, 60_000, 100)
    `;
    await client.end({ timeout: 2 });

    const result = await dispatch(makeInput({ budgetConfig: TIGHT_BUDGET }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected budget_exhausted but got ok=true');
    expect(result.error).toBe('budget_exhausted');

    // openrouter must NOT have been called
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);
  });

  it('writes ai.budget_exhausted audit row when cap is exceeded', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      VALUES (${ORG_ID}::uuid, ${today}::date, 150_000, 60_000, 50)
    `;
    await client.end({ timeout: 2 });

    await dispatch(makeInput({ budgetConfig: TIGHT_BUDGET, key: 'audit-check' }));

    const rows = dbRows<{ event_type: string }>(
      await db.execute(
        sql`SELECT event_type FROM audit_log WHERE event_type = 'ai.budget_exhausted'`,
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.event_type).toBe('ai.budget_exhausted');
  });

  it('hard stop — no rows added to ai_cache on budget exhaustion', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      VALUES (${ORG_ID}::uuid, ${today}::date, 180_000, 25_000, 80)
    `;
    await client.end({ timeout: 2 });

    await dispatch(makeInput({ budgetConfig: TIGHT_BUDGET, key: 'no-cache-on-budget-fail' }));

    const cacheRows = dbRows<{ cnt: string }>(
      await db.execute(sql`SELECT COUNT(*) AS cnt FROM ai_cache`),
    );
    expect(Number(cacheRows[0]!.cnt)).toBe(0);
  });
});

// ── Scenario 2: Exceed user hour rate limit ───────────────────────────────────

describe('T39 Scenario 2: exceed user hour rate limit → rate_limited error', () => {
  it('returns rate_limited error when user has exceeded hourly request cap', async () => {
    // Prime ai_rate_limit with > userHourRequestCap (20) requests in current hour bucket
    const bucketStart = new Date();
    bucketStart.setMinutes(0, 0, 0);
    const bucketIso = bucketStart.toISOString();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_rate_limit (user_id, bucket_start, requests)
      VALUES (${USER_ID}::uuid, ${bucketIso}::timestamptz, 25)
    `;
    await client.end({ timeout: 2 });

    const result = await dispatch(
      makeInput({ budgetConfig: TIGHT_BUDGET, key: 'rate-limit-test' }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected rate_limited but got ok=true');
    expect(result.error).toBe('rate_limited');
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);
  });

  it('writes an audit row on rate limit hit', async () => {
    const bucketStart = new Date();
    bucketStart.setMinutes(0, 0, 0);
    const bucketIso = bucketStart.toISOString();

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_rate_limit (user_id, bucket_start, requests)
      VALUES (${USER_ID}::uuid, ${bucketIso}::timestamptz, 30)
    `;
    await client.end({ timeout: 2 });

    await dispatch(makeInput({ budgetConfig: TIGHT_BUDGET, key: 'rate-limit-audit' }));

    // budget_exhausted covers both org cap and rate limit in the audit log
    const rows = dbRows<{ event_type: string }>(
      await db.execute(
        sql`SELECT event_type FROM audit_log WHERE event_type = 'ai.budget_exhausted'`,
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Scenario 3: Cache hit bypasses budget ─────────────────────────────────────

describe('T39 Scenario 3: cache hit bypasses budget guard — cached result returned even when cap exhausted', () => {
  it('returns cached result even when org daily budget is exhausted', async () => {
    // Step 1: Prime the cache with a valid result (budget is OK at this point)
    const primeResult = await dispatch(
      makeInput({ budgetConfig: GENEROUS_BUDGET, key: 'cached-bypass' }),
    );
    expect(primeResult.ok).toBe(true);
    if (!primeResult.ok) throw new Error('Priming failed');
    expect(primeResult.cached).toBe(false);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    // Step 2: Now exhaust the budget
    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      VALUES (${ORG_ID}::uuid, ${today}::date, 195_000, 10_000, 200)
      ON CONFLICT (org_id, date) DO UPDATE SET
        prompt_tokens = 195_000, completion_tokens = 10_000, requests = 200
    `;
    await client.end({ timeout: 2 });
    mockCallOpenRouter.mockClear();

    // Step 3: Call again with the same input — should hit cache, bypassing budget
    const cachedResult = await dispatch(
      makeInput({ budgetConfig: TIGHT_BUDGET, key: 'cached-bypass' }),
    );

    // KEY ASSERTION: cache hit returns ok=true even though budget is exhausted
    expect(cachedResult.ok).toBe(true);
    if (!cachedResult.ok) {
      throw new Error(`Expected cache hit but got error: ${cachedResult.error}`);
    }
    expect(cachedResult.cached).toBe(true);
    // openrouter must NOT have been called — cache hit, no new cost
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);
  });
});

// ── Scenario 4: Advisory lock stampede ───────────────────────────────────────

describe('T39 Scenario 4: advisory lock stampede — two parallel calls → only one openrouter call', () => {
  it('two parallel calls with same scope+content → only one proceeds, second returns from cache', async () => {
    let callCount = 0;

    mockCallOpenRouter.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Slow down first call to force overlap
        await new Promise<void>((resolve) => setTimeout(resolve, 60));
      }
      return {
        content: { result: 'stampede-test' },
        promptTokens: 100,
        completionTokens: 50,
        model: 'openai/gpt-4o-mini',
      };
    });

    const input = makeInput({
      budgetConfig: GENEROUS_BUDGET,
      key: 'stampede-key',
      scopeKey: `org:${ORG_ID}|key:stampede`,
    });

    // Launch both in parallel — advisory lock should serialize them
    const [r1, r2] = await Promise.all([dispatch(input), dispatch(input)]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // Only ONE call to openrouter (advisory lock serializes, second gets cache)
    expect(
      mockCallOpenRouter,
      'advisory lock must serialize — only 1 openrouter call expected',
    ).toHaveBeenCalledTimes(1);

    // One result must be cached
    const results = [r1, r2].filter((r) => r.ok) as Array<{
      ok: true;
      cached: boolean;
      output: { result: string };
      promptTokens: number;
      completionTokens: number;
    }>;
    const cachedCount = results.filter((r) => r.cached).length;
    const freshCount = results.filter((r) => !r.cached).length;
    expect(cachedCount).toBe(1);
    expect(freshCount).toBe(1);

    // Both results have the same output
    expect(results[0]!.output.result).toBe('stampede-test');
    expect(results[1]!.output.result).toBe('stampede-test');
  });
});
