import type { DB } from '../../db/client';
import { type DispatchResult, dispatch } from '../core/dispatch';
import { redactPII } from '../core/redact';
import { midYearNudgesJsonSchema, midYearNudgesSchema } from '../core/schemas';

export interface KraProgress {
  kraId: string;
  description: string;
  target: string;
  progressPct: number;
  latestComment?: string;
}

export interface MidYearNudgesInput {
  orgId: string;
  cycleId: string;
  /** Progress data for each KRA */
  kraProgress: KraProgress[];
  /** Number of calendar days remaining in the cycle */
  remainingDays: number;
}

export interface MidYearNudgesOutput {
  per_kra_nudge: Array<{ kra_id: string; nudge: string }>;
  overall_focus: string;
}

type Actor = {
  userId: string;
  orgId: string;
  staffId: string | null;
  roles: string[];
};

const SYSTEM_MESSAGE = [
  'You are an HR performance coaching assistant. Generate mid-year nudges based on KRA progress and remaining cycle time.',
  'Output ONLY valid JSON matching this schema. Do not add narration.',
  'Do not mention protected characteristics. Do not claim to take actions.',
].join(' ');

export async function runMidYearNudges(args: {
  db: DB;
  actor: Actor;
  input: MidYearNudgesInput;
}): Promise<DispatchResult<MidYearNudgesOutput>> {
  const { db, actor, input } = args;
  const { orgId, cycleId } = input;

  const scopeKey = `org:${orgId}|cycle:${cycleId}|section:mid_year`;

  return dispatch<MidYearNudgesInput, MidYearNudgesOutput>({
    db,
    actor,
    feature: 'mid_year_nudges',
    scopeKey,
    input,
    model: 'openai/gpt-5.4-nano',
    temperature: 0.3,
    maxTokens: 600,
    buildMessages: (inp) => {
      const { redacted } = redactPII(inp);
      return [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: JSON.stringify(redacted) },
      ];
    },
    responseSchema: midYearNudgesSchema,
    jsonSchema: midYearNudgesJsonSchema,
  });
}
