import './setup';
import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import postgres from 'postgres';
import * as openrouterMod from '../src/ai/core/openrouter';
import { runStaffSummary } from '../src/ai/features/staff-summary';
import { db } from '../src/db/client';

// ──────────────────────────────────────────────
// Spy setup
// ──────────────────────────────────────────────

const mockCallOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(async () => ({
  content: {
    highlights: ['Exceeded KRA targets in Q2'],
    concerns: [],
    focus_areas: ['Time management'],
  },
  promptTokens: 100,
  completionTokens: 80,
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

const actorA = { userId: USER_A, orgId: ORG_A, staffId: null, roles: ['hr_manager'] };
const actorB = { userId: USER_B, orgId: ORG_B, staffId: null, roles: ['hr_manager'] };

const baseInput = {
  orgId: ORG_A,
  cycleId: 'cycle-001',
  snapshot: {
    staffId: 'staff-abc',
    kraScores: [{ kraId: 'kra-1', score: 4, weight: 60 }],
    overallRating: 4,
    grade: 'G5',
  },
};

function resetMock() {
  mockCallOpenRouter.mockClear();
  mockCallOpenRouter.mockImplementation(async () => ({
    content: {
      highlights: ['Exceeded KRA targets in Q2'],
      concerns: [],
      focus_areas: ['Time management'],
    },
    promptTokens: 100,
    completionTokens: 80,
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

describe('runStaffSummary', () => {
  it('happy path: returns ok with valid output shape', async () => {
    const result = await runStaffSummary({ db, actor: actorA, input: baseInput });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(false);
    expect(result.output.highlights).toBeInstanceOf(Array);
    expect(result.output.highlights.length).toBeGreaterThanOrEqual(1);
    expect(result.output.concerns).toBeInstanceOf(Array);
    expect(result.output.focus_areas).toBeInstanceOf(Array);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });

  it('schema failure: invalid response shape → { ok: false, error: "schema_failed" }', async () => {
    mockCallOpenRouter.mockImplementation(async () => ({
      content: { wrong_key: 'not the right shape' },
      promptTokens: 50,
      completionTokens: 20,
      model: 'openai/gpt-5.4-nano',
    }));

    const result = await runStaffSummary({ db, actor: actorA, input: baseInput });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('schema_failed');
  });

  it('cache hit: second call with same input returns cached: true, stub called once', async () => {
    const result1 = await runStaffSummary({ db, actor: actorA, input: baseInput });
    expect(result1.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    const result2 = await runStaffSummary({ db, actor: actorA, input: baseInput });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.cached).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);
  });

  it('cross-scope isolation: different orgs with same input get separate cache entries', async () => {
    const inputA = { ...baseInput, orgId: ORG_A };
    const inputB = { ...baseInput, orgId: ORG_B };

    const resultA = await runStaffSummary({ db, actor: actorA, input: inputA });
    expect(resultA.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    // Different org — must NOT use org A's cache
    const resultB = await runStaffSummary({ db, actor: actorB, input: inputB });
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.cached).toBe(false);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });
});
