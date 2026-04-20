import type { DB } from '../../db/client';
import { type DispatchResult, dispatch } from '../core/dispatch';
import { redactPII } from '../core/redact';
import { staffSummaryJsonSchema, staffSummarySchema } from '../core/schemas';

export interface StaffSummaryInput {
  orgId: string;
  cycleId: string;
  /** Snapshot of staff performance data for the cycle */
  snapshot: {
    staffId: string;
    kraScores?: Array<{ kraId: string; score: number; weight: number }>;
    behaviouralRatings?: Array<{ dimension: string; score: number }>;
    selfAssessmentSummary?: string;
    managerAssessmentSummary?: string;
    overallRating?: number;
    grade?: string;
  };
}

export interface StaffSummaryOutput {
  highlights: string[];
  concerns: string[];
  focus_areas: string[];
}

type Actor = {
  userId: string;
  orgId: string;
  staffId: string | null;
  roles: string[];
};

const SYSTEM_MESSAGE = [
  "You are an HR analytics assistant. Summarise a staff member's performance cycle snapshot.",
  'Output ONLY valid JSON matching this schema. Do not add narration.',
  'Do not mention protected characteristics. Do not claim to take actions.',
].join(' ');

export async function runStaffSummary(args: {
  db: DB;
  actor: Actor;
  input: StaffSummaryInput;
}): Promise<DispatchResult<StaffSummaryOutput>> {
  const { db, actor, input } = args;
  const { orgId, cycleId } = input;

  const scopeKey = `org:${orgId}|cycle:${cycleId}`;

  return dispatch<StaffSummaryInput, StaffSummaryOutput>({
    db,
    actor,
    feature: 'staff_summary',
    scopeKey,
    input,
    model: 'openai/gpt-5.4-nano',
    temperature: 0.4,
    maxTokens: 600,
    buildMessages: (inp) => {
      const { redacted } = redactPII(inp, { stripNames: false });
      return [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: JSON.stringify(redacted) },
      ];
    },
    responseSchema: staffSummarySchema,
    jsonSchema: staffSummaryJsonSchema,
  });
}
