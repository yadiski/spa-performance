import './setup';
import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import postgres from 'postgres';
import * as openrouterMod from '../src/ai/core/openrouter';
import { runMidYearNudges } from '../src/ai/features/mid-year-nudges';
import { db } from '../src/db/client';

// ──────────────────────────────────────────────
// Spy setup
// ──────────────────────────────────────────────

const mockCallOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(async () => ({
  content: {
    per_kra_nudge: [
      {
        kra_id: 'kra-001',
        nudge: 'Focus on closing the remaining 20% gap by increasing weekly check-ins.',
      },
      { kra_id: 'kra-002', nudge: 'Excellent progress — maintain current momentum.' },
    ],
    overall_focus: 'Prioritise KRA-001 delivery and document evidence for appraisal.',
  },
  promptTokens: 160,
  completionTokens: 110,
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

const actorA = { userId: USER_A, orgId: ORG_A, staffId: null, roles: ['staff'] };
const actorB = { userId: USER_B, orgId: ORG_B, staffId: null, roles: ['staff'] };

const baseInput = {
  orgId: ORG_A,
  cycleId: 'cycle-001',
  kraProgress: [
    {
      kraId: 'kra-001',
      description: 'Reduce processing time by 30%',
      target: '30% reduction',
      progressPct: 60,
      latestComment: 'On track with process redesign',
    },
    {
      kraId: 'kra-002',
      description: 'Complete compliance certification',
      target: 'Certified by Q3',
      progressPct: 100,
    },
  ],
  remainingDays: 45,
};

function resetMock() {
  mockCallOpenRouter.mockClear();
  mockCallOpenRouter.mockImplementation(async () => ({
    content: {
      per_kra_nudge: [
        {
          kra_id: 'kra-001',
          nudge: 'Focus on closing the remaining 20% gap by increasing weekly check-ins.',
        },
        { kra_id: 'kra-002', nudge: 'Excellent progress — maintain current momentum.' },
      ],
      overall_focus: 'Prioritise KRA-001 delivery and document evidence for appraisal.',
    },
    promptTokens: 160,
    completionTokens: 110,
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

describe('runMidYearNudges', () => {
  it('happy path: returns ok with valid output shape', async () => {
    const result = await runMidYearNudges({ db, actor: actorA, input: baseInput });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(false);
    expect(result.output.per_kra_nudge).toBeInstanceOf(Array);
    expect(result.output.per_kra_nudge.length).toBeGreaterThanOrEqual(1);
    for (const item of result.output.per_kra_nudge) {
      expect(typeof item.kra_id).toBe('string');
      expect(typeof item.nudge).toBe('string');
    }
    expect(typeof result.output.overall_focus).toBe('string');
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });

  it('schema failure: invalid response shape → { ok: false, error: "schema_failed" }', async () => {
    mockCallOpenRouter.mockImplementation(async () => ({
      content: { nudges: 'not_the_right_shape' },
      promptTokens: 50,
      completionTokens: 20,
      model: 'openai/gpt-5.4-nano',
    }));

    const result = await runMidYearNudges({ db, actor: actorA, input: baseInput });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('schema_failed');
  });

  it('cache hit: second call with same input returns cached: true, stub called once', async () => {
    const result1 = await runMidYearNudges({ db, actor: actorA, input: baseInput });
    expect(result1.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    const result2 = await runMidYearNudges({ db, actor: actorA, input: baseInput });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.cached).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);
  });

  it('cross-scope isolation: different orgs get separate cache entries', async () => {
    const inputA = { ...baseInput, orgId: ORG_A };
    const inputB = { ...baseInput, orgId: ORG_B };

    const resultA = await runMidYearNudges({ db, actor: actorA, input: inputA });
    expect(resultA.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    const resultB = await runMidYearNudges({ db, actor: actorB, input: inputB });
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.cached).toBe(false);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });
});
