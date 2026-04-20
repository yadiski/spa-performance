import './setup';
import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import postgres from 'postgres';
import * as openrouterMod from '../src/ai/core/openrouter';
import { runKraQuality } from '../src/ai/features/kra-quality';
import { db } from '../src/db/client';

// ──────────────────────────────────────────────
// Spy setup
// ──────────────────────────────────────────────

const mockCallOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(async () => ({
  content: {
    smart_score: 72,
    issues: ['Target is not time-bound'],
    suggested_rewrite: 'Achieve 95% customer satisfaction by end of Q4 FY2025.',
  },
  promptTokens: 120,
  completionTokens: 60,
  model: 'openai/gpt-5.4-nano',
}));

afterAll(() => {
  mockCallOpenRouter.mockRestore();
});

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER_A = '44444444-4444-4444-4444-444444444444';
const USER_B = '55555555-5555-5555-5555-555555555555';

const actorA = { userId: USER_A, orgId: ORG_A, staffId: null, roles: ['appraiser'] };
const actorB = { userId: USER_B, orgId: ORG_B, staffId: null, roles: ['appraiser'] };

const baseInput = {
  orgId: ORG_A,
  kraId: 'kra-xyz-001',
  kra: {
    perspective: 'customer',
    description: 'Improve customer satisfaction scores across all touchpoints.',
    weightPct: 30,
    measurement: 'Customer satisfaction survey score',
    target: 'Score above 90%',
  },
};

function resetMock() {
  mockCallOpenRouter.mockClear();
  mockCallOpenRouter.mockImplementation(async () => ({
    content: {
      smart_score: 72,
      issues: ['Target is not time-bound'],
      suggested_rewrite: 'Achieve 95% customer satisfaction by end of Q4 FY2025.',
    },
    promptTokens: 120,
    completionTokens: 60,
    model: 'openai/gpt-5.4-nano',
  }));
}

beforeEach(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table ai_cache, ai_usage_daily, ai_rate_limit`;
  await client`truncate table audit_log`;
  await client.end({ timeout: 2 });
  resetMock();
});

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('runKraQuality', () => {
  it('happy path: returns ok with valid output shape', async () => {
    const result = await runKraQuality({ db, actor: actorA, input: baseInput });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(false);
    expect(typeof result.output.smart_score).toBe('number');
    expect(result.output.smart_score).toBeGreaterThanOrEqual(0);
    expect(result.output.smart_score).toBeLessThanOrEqual(100);
    expect(result.output.issues).toBeInstanceOf(Array);
    expect(typeof result.output.suggested_rewrite).toBe('string');
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });

  it('schema failure: invalid response shape → { ok: false, error: "schema_failed" }', async () => {
    mockCallOpenRouter.mockImplementation(async () => ({
      content: { score: 'not_a_number', missing_keys: true },
      promptTokens: 50,
      completionTokens: 20,
      model: 'openai/gpt-5.4-nano',
    }));

    const result = await runKraQuality({ db, actor: actorA, input: baseInput });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('schema_failed');
  });

  it('cache hit: second call with same input returns cached: true, stub called once', async () => {
    const result1 = await runKraQuality({ db, actor: actorA, input: baseInput });
    expect(result1.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    const result2 = await runKraQuality({ db, actor: actorA, input: baseInput });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.cached).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);
  });

  it('cross-scope isolation: different orgs get separate cache entries', async () => {
    const inputA = { ...baseInput, orgId: ORG_A };
    const inputB = { ...baseInput, orgId: ORG_B };

    const resultA = await runKraQuality({ db, actor: actorA, input: inputA });
    expect(resultA.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    const resultB = await runKraQuality({ db, actor: actorB, input: inputB });
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.cached).toBe(false);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });
});
