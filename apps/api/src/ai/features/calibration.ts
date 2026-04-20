import type { DB } from '../../db/client';
import { type DispatchResult, dispatch } from '../core/dispatch';
import { redactPII } from '../core/redact';
import { calibrationJsonSchema, calibrationSchema } from '../core/schemas';

export interface CalibrationPeerRating {
  /** Will be anonymized before sending to the model */
  staffId: string;
  overallRating: number;
  kraScores?: Array<{ kraId: string; score: number }>;
  behaviouralRatings?: Array<{ dimension: string; score: number }>;
}

export interface CalibrationInput {
  orgId: string;
  gradeId: string;
  fy: string;
  /** Anonymized same-grade peer ratings */
  peerRatings: CalibrationPeerRating[];
}

export interface CalibrationOutput {
  outliers: string[];
  inconsistency_flags: string[];
  talking_points: string[];
}

type Actor = {
  userId: string;
  orgId: string;
  staffId: string | null;
  roles: string[];
};

const SYSTEM_MESSAGE = [
  'You are an HR calibration assistant. Analyse anonymized same-grade peer ratings for calibration purposes.',
  'Output ONLY valid JSON matching this schema. Do not add narration.',
  'Do not mention protected characteristics. Do not claim to take actions.',
].join(' ');

export async function runCalibration(args: {
  db: DB;
  actor: Actor;
  input: CalibrationInput;
}): Promise<DispatchResult<CalibrationOutput>> {
  const { db, actor, input } = args;
  const { orgId, gradeId, fy } = input;

  const scopeKey = `org:${orgId}|grade:${gradeId}|fy:${fy}`;

  return dispatch<CalibrationInput, CalibrationOutput>({
    db,
    actor,
    feature: 'calibration',
    scopeKey,
    input,
    model: 'openai/gpt-5.4-nano',
    temperature: 0,
    maxTokens: 600,
    buildMessages: (inp) => {
      // Full anonymization: strip names AND anonymize staffIds
      const { redacted } = redactPII(inp, { anonymize: true, stripNames: true });
      return [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: JSON.stringify(redacted) },
      ];
    },
    responseSchema: calibrationSchema,
    jsonSchema: calibrationJsonSchema,
  });
}
