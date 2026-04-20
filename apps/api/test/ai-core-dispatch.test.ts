import './setup';
import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { z } from 'zod';
import type { BudgetConfig } from '../src/ai/core/budget';
import { dispatch } from '../src/ai/core/dispatch';
import * as openrouterMod from '../src/ai/core/openrouter';
import { db } from '../src/db/client';

// ──────────────────────────────────────────────
// Spy setup — must be set up before any imports
// that would call the real function
// ──────────────────────────────────────────────

const mockCallOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(async () => ({
  content: { result: 'mocked' },
  promptTokens: 100,
  completionTokens: 50,
  model: 'openai/gpt-4o-mini',
}));

afterAll(() => {
  mockCallOpenRouter.mockRestore();
});

// ──────────────────────────────────────────────
// Shared fixtures
// ──────────────────────────────────────────────

const TEST_ORG_ID = '33333333-3333-3333-3333-333333333333';
const TEST_USER_ID = '44444444-4444-4444-4444-444444444444';

const testActor = {
  userId: TEST_USER_ID,
  orgId: TEST_ORG_ID,
  staffId: null,
  roles: ['staff'],
};

const testSchema = z.object({ result: z.string() }).passthrough();

const testJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: { result: { type: 'string' } },
  required: ['result'],
};

const GENEROUS_BUDGET: BudgetConfig = { dailyOrgTokenCap: 10_000_000, userHourRequestCap: 1000 };

type TestInput = { staffId: string; cycleId: string };

function makeDispatchInput(
  overrides: {
    scopeKey?: string;
    input?: TestInput;
    // biome-ignore lint/suspicious/noExplicitAny: test helper override
    responseSchema?: z.ZodType<any>;
    budgetConfig?: BudgetConfig;
  } = {},
) {
  return {
    db,
    actor: testActor,
    feature: 'staff_summary',
    scopeKey: overrides.scopeKey ?? `org:${TEST_ORG_ID}|subject:cycle-abc`,
    input: overrides.input ?? { staffId: 'staff-1', cycleId: 'cycle-abc' },
    model: 'openai/gpt-4o-mini',
    buildMessages: (inp: TestInput) => [
      { role: 'system' as const, content: 'You are a helpful AI.' },
      { role: 'user' as const, content: `Summarise ${inp.staffId} for cycle ${inp.cycleId}` },
    ],
    responseSchema: overrides.responseSchema ?? testSchema,
    jsonSchema: testJsonSchema,
    budgetConfig: overrides.budgetConfig ?? GENEROUS_BUDGET,
  };
}

beforeEach(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table ai_cache, ai_usage_daily, ai_rate_limit`;
  await client`truncate table audit_log`;
  await client.end({ timeout: 2 });
  mockCallOpenRouter.mockClear();
  // Reset default mock implementation
  mockCallOpenRouter.mockImplementation(async () => ({
    content: { result: 'mocked' },
    promptTokens: 100,
    completionTokens: 50,
    model: 'openai/gpt-4o-mini',
  }));
});

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('dispatch', () => {
  it('T1: cache miss → calls openrouter → caches → returns ok', async () => {
    const result = await dispatch(makeDispatchInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(false);
    expect(result.output).toMatchObject({ result: 'mocked' });
    expect(result.promptTokens).toBe(100);
    expect(result.completionTokens).toBe(50);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    // Verify audit row was written
    const auditRows = (await db.execute(
      sql`SELECT event_type FROM audit_log WHERE event_type = 'ai.call_succeeded'`,
    )) as Array<{ event_type: string }>;
    const rows = Array.isArray(auditRows)
      ? auditRows
      : ((auditRows as { rows?: unknown[] }).rows ?? []);
    expect(rows.length).toBe(1);
  });

  it('T2: cache hit → NO openrouter call, returns cached output with cached: true', async () => {
    // First call to populate cache
    const result1 = await dispatch(makeDispatchInput());
    expect(result1.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    // Second call with same input — should hit cache
    const result2 = await dispatch(makeDispatchInput());
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.cached).toBe(true);
    expect(result2.output).toMatchObject({ result: 'mocked' });
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);

    // Cache hit does NOT write an audit row
    const auditRows = (await db.execute(
      sql`SELECT event_type FROM audit_log WHERE event_type = 'ai.call_succeeded'`,
    )) as Array<{ event_type: string }>;
    const rows = Array.isArray(auditRows)
      ? auditRows
      : ((auditRows as { rows?: unknown[] }).rows ?? []);
    // Only one audit row from the first (non-cached) call
    expect(rows.length).toBe(1);
  });

  it('T3: schema validation failure → returns error, writes audit, does NOT cache', async () => {
    // Return content that doesn't match schema (missing `result`)
    mockCallOpenRouter.mockImplementation(async () => ({
      content: { wrong_field: 123 },
      promptTokens: 100,
      completionTokens: 50,
      model: 'openai/gpt-4o-mini',
    }));

    const strictSchema = z.object({ result: z.string() }).strict();
    const result = await dispatch(makeDispatchInput({ responseSchema: strictSchema }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('schema_failed');

    // Verify schema_failed audit row
    const auditRows = (await db.execute(
      sql`SELECT event_type FROM audit_log WHERE event_type = 'ai.schema_failed'`,
    )) as Array<{ event_type: string }>;
    const rows = Array.isArray(auditRows)
      ? auditRows
      : ((auditRows as { rows?: unknown[] }).rows ?? []);
    expect(rows.length).toBe(1);

    // Verify nothing was cached
    const cacheRows = (await db.execute(sql`SELECT COUNT(*) AS cnt FROM ai_cache`)) as Array<{
      cnt: string;
    }>;
    const cacheArr = Array.isArray(cacheRows)
      ? cacheRows
      : ((cacheRows as { rows?: unknown[] }).rows ?? []);
    expect(Number((cacheArr[0] as { cnt: string })?.cnt)).toBe(0);
  });

  it('T4: budget exhausted → returns error, writes audit, does NOT call openrouter', async () => {
    // Seed usage that exhausts the cap
    const today = new Date().toISOString().slice(0, 10);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      INSERT INTO ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests)
      VALUES (${TEST_ORG_ID}::uuid, ${today}::date, 150000, 60000, 100)
    `;
    await client.end({ timeout: 2 });

    const result = await dispatch(
      makeDispatchInput({ budgetConfig: { dailyOrgTokenCap: 200_000, userHourRequestCap: 20 } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('budget_exhausted');
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);

    // Verify budget_exhausted audit row
    const auditRows = (await db.execute(
      sql`SELECT event_type FROM audit_log WHERE event_type = 'ai.budget_exhausted'`,
    )) as Array<{ event_type: string }>;
    const rows = Array.isArray(auditRows)
      ? auditRows
      : ((auditRows as { rows?: unknown[] }).rows ?? []);
    expect(rows.length).toBe(1);
  });

  it('T5: two parallel calls with same scope+content → advisory lock serializes, second returns cached (one openrouter call)', async () => {
    let resolveFirst: () => void;
    let callCount = 0;

    // Make callOpenRouter slow on first call to force overlap
    mockCallOpenRouter.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call: add a small delay to let the second call queue up
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
          setTimeout(resolve, 50);
        });
      }
      return {
        content: { result: 'parallel-test' },
        promptTokens: 100,
        completionTokens: 50,
        model: 'openai/gpt-4o-mini',
      };
    });

    const input = makeDispatchInput({
      scopeKey: `org:${TEST_ORG_ID}|subject:parallel-test`,
      input: { staffId: 'parallel', cycleId: 'cycle-p' },
    });

    // Launch both in parallel
    const [r1, r2] = await Promise.all([dispatch(input), dispatch(input)]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // Advisory lock serializes: only ONE call to openrouter
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    // One of them must be cached (the second that acquires the lock)
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
  });
});
