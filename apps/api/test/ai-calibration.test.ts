import './setup';
import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import postgres from 'postgres';
import * as openrouterMod from '../src/ai/core/openrouter';
import { runCalibration } from '../src/ai/features/calibration';
import { db } from '../src/db/client';

// ──────────────────────────────────────────────
// Spy setup
// ──────────────────────────────────────────────

const mockCallOpenRouter = spyOn(openrouterMod, 'callOpenRouter').mockImplementation(async () => ({
  content: {
    outliers: ['Staff C rated notably higher than cohort average'],
    inconsistency_flags: ['Staff A received diverging ratings from two appraisers'],
    talking_points: [
      'Review distribution of ratings across grade',
      'Discuss normalization criteria',
    ],
  },
  promptTokens: 200,
  completionTokens: 100,
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
  gradeId: 'grade-g5',
  fy: '2025',
  peerRatings: [
    {
      staffId: 'staff-real-001',
      overallRating: 4,
      behaviouralRatings: [{ dimension: 'collaboration', score: 4 }],
    },
    {
      staffId: 'staff-real-002',
      overallRating: 3,
      behaviouralRatings: [{ dimension: 'collaboration', score: 3 }],
    },
    {
      staffId: 'staff-real-003',
      overallRating: 5,
      behaviouralRatings: [{ dimension: 'collaboration', score: 5 }],
    },
  ],
};

function resetMock() {
  mockCallOpenRouter.mockClear();
  mockCallOpenRouter.mockImplementation(async () => ({
    content: {
      outliers: ['Staff C rated notably higher than cohort average'],
      inconsistency_flags: ['Staff A received diverging ratings from two appraisers'],
      talking_points: [
        'Review distribution of ratings across grade',
        'Discuss normalization criteria',
      ],
    },
    promptTokens: 200,
    completionTokens: 100,
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

describe('runCalibration', () => {
  it('happy path: returns ok with valid output shape', async () => {
    const result = await runCalibration({ db, actor: actorA, input: baseInput });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(false);
    expect(result.output.outliers).toBeInstanceOf(Array);
    expect(result.output.inconsistency_flags).toBeInstanceOf(Array);
    expect(result.output.talking_points).toBeInstanceOf(Array);
    expect(result.output.talking_points.length).toBeGreaterThanOrEqual(1);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });

  it('schema failure: invalid response shape → { ok: false, error: "schema_failed" }', async () => {
    mockCallOpenRouter.mockImplementation(async () => ({
      content: { issues: 'not_an_object_with_right_keys' },
      promptTokens: 50,
      completionTokens: 20,
      model: 'openai/gpt-5.4-nano',
    }));

    const result = await runCalibration({ db, actor: actorA, input: baseInput });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('schema_failed');
  });

  it('cache hit: second call with same input returns cached: true, stub called once', async () => {
    const result1 = await runCalibration({ db, actor: actorA, input: baseInput });
    expect(result1.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    const result2 = await runCalibration({ db, actor: actorA, input: baseInput });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.cached).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(0);
  });

  it('cross-scope isolation: different orgs get separate cache entries', async () => {
    const inputA = { ...baseInput, orgId: ORG_A };
    const inputB = { ...baseInput, orgId: ORG_B };

    const resultA = await runCalibration({ db, actor: actorA, input: inputA });
    expect(resultA.ok).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

    mockCallOpenRouter.mockClear();

    const resultB = await runCalibration({ db, actor: actorB, input: inputB });
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.cached).toBe(false);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });

  it('anonymization: prompt sent to OpenRouter must NOT contain staffId or real names', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];

    mockCallOpenRouter.mockImplementation(async (inp) => {
      capturedMessages = inp.messages as Array<{ role: string; content: string }>;
      return {
        content: {
          outliers: [],
          inconsistency_flags: [],
          talking_points: ['All ratings within expected range'],
        },
        promptTokens: 200,
        completionTokens: 80,
        model: 'openai/gpt-5.4-nano',
      };
    });

    await runCalibration({ db, actor: actorA, input: baseInput });

    // All message content combined
    const allContent = capturedMessages.map((m) => m.content).join('\n');

    // Real staffIds must NOT appear in the prompt
    for (const rating of baseInput.peerRatings) {
      expect(allContent).not.toContain(rating.staffId);
    }
  });
});
