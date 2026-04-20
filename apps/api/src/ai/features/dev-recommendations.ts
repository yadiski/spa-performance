import type { DB } from '../../db/client';
import { type DispatchResult, dispatch } from '../core/dispatch';
import { redactPII } from '../core/redact';
import { devRecommendationsJsonSchema, devRecommendationsSchema } from '../core/schemas';

export interface DevRecommendationsInput {
  orgId: string;
  cycleId: string;
  /** Career and growth summary */
  careerSummary: string;
  /** Growth area summary */
  growthSummary: string;
  /** Behavioural assessment summary */
  behaviouralSummary: string;
  /** Staff grade / level */
  grade: string;
}

export interface DevRecommendationsOutput {
  training: string[];
  stretch: string[];
  mentorship: string[];
}

type Actor = {
  userId: string;
  orgId: string;
  staffId: string | null;
  roles: string[];
};

const SYSTEM_MESSAGE = [
  'You are an HR learning and development assistant. Generate development recommendations based on career, growth, and behavioural assessment data.',
  'Output ONLY valid JSON matching this schema. Do not add narration.',
  'Do not mention protected characteristics. Do not claim to take actions.',
].join(' ');

export async function runDevRecommendations(args: {
  db: DB;
  actor: Actor;
  input: DevRecommendationsInput;
}): Promise<DispatchResult<DevRecommendationsOutput>> {
  const { db, actor, input } = args;
  const { orgId, cycleId } = input;

  const scopeKey = `org:${orgId}|cycle:${cycleId}|section:career+growth`;

  return dispatch<DevRecommendationsInput, DevRecommendationsOutput>({
    db,
    actor,
    feature: 'dev_recommendations',
    scopeKey,
    input,
    model: 'openai/gpt-5.4-nano',
    temperature: 0.3,
    maxTokens: 600,
    buildMessages: (inp) => {
      const { redacted } = redactPII(inp, { stripNames: true });
      return [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: JSON.stringify(redacted) },
      ];
    },
    responseSchema: devRecommendationsSchema,
    jsonSchema: devRecommendationsJsonSchema,
  });
}
