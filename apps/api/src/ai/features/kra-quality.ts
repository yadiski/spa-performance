import type { DB } from '../../db/client';
import { type DispatchResult, dispatch } from '../core/dispatch';
import { redactPII } from '../core/redact';
import { kraQualityJsonSchema, kraQualitySchema } from '../core/schemas';

export interface KraQualityInput {
  orgId: string;
  kraId: string;
  /** The KRA content to analyse */
  kra: {
    perspective: string;
    description: string;
    weightPct: number;
    measurement: string;
    target: string;
    rubric1to5?: string[];
  };
}

export interface KraQualityOutput {
  smart_score: number;
  issues: string[];
  suggested_rewrite: string;
}

type Actor = {
  userId: string;
  orgId: string;
  staffId: string | null;
  roles: string[];
};

const SYSTEM_MESSAGE = [
  'You are an HR quality-assurance assistant. Evaluate a Key Result Area (KRA) against SMART criteria.',
  'Output ONLY valid JSON matching this schema. Do not add narration.',
  'Do not mention protected characteristics. Do not claim to take actions.',
].join(' ');

export async function runKraQuality(args: {
  db: DB;
  actor: Actor;
  input: KraQualityInput;
}): Promise<DispatchResult<KraQualityOutput>> {
  const { db, actor, input } = args;
  const { orgId, kraId } = input;

  const scopeKey = `org:${orgId}|kra:${kraId}`;

  return dispatch<KraQualityInput, KraQualityOutput>({
    db,
    actor,
    feature: 'kra_quality',
    scopeKey,
    input,
    model: 'openai/gpt-5.4-nano',
    temperature: 0,
    maxTokens: 600,
    buildMessages: (inp) => {
      const { redacted } = redactPII(inp);
      return [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: JSON.stringify(redacted) },
      ];
    },
    responseSchema: kraQualitySchema,
    jsonSchema: kraQualityJsonSchema,
  });
}
