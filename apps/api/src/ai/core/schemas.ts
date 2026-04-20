import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// staff-summary (T6)
// ─────────────────────────────────────────────────────────────────────────────

export const staffSummarySchema = z
  .object({
    highlights: z.array(z.string().min(1)).min(1).max(8),
    concerns: z.array(z.string().min(1)).max(8),
    focus_areas: z.array(z.string().min(1)).max(5),
  })
  .strict();

export const staffSummaryJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    highlights: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 1,
      maxItems: 8,
    },
    concerns: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 8,
    },
    focus_areas: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 5,
    },
  },
  required: ['highlights', 'concerns', 'focus_areas'],
  additionalProperties: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// kra-quality (T7)
// ─────────────────────────────────────────────────────────────────────────────

export const kraQualitySchema = z
  .object({
    smart_score: z.number().int().min(0).max(100),
    issues: z.array(z.string().min(1)).max(10),
    suggested_rewrite: z.string().min(1).max(2000),
  })
  .strict();

export const kraQualityJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    smart_score: { type: 'integer', minimum: 0, maximum: 100 },
    issues: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 10,
    },
    suggested_rewrite: { type: 'string', minLength: 1, maxLength: 2000 },
  },
  required: ['smart_score', 'issues', 'suggested_rewrite'],
  additionalProperties: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// dev-recommendations (T8)
// ─────────────────────────────────────────────────────────────────────────────

export const devRecommendationsSchema = z
  .object({
    training: z.array(z.string().min(1)).max(6),
    stretch: z.array(z.string().min(1)).max(6),
    mentorship: z.array(z.string().min(1)).max(4),
  })
  .strict();

export const devRecommendationsJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    training: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 6,
    },
    stretch: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 6,
    },
    mentorship: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 4,
    },
  },
  required: ['training', 'stretch', 'mentorship'],
  additionalProperties: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// calibration (T9)
// ─────────────────────────────────────────────────────────────────────────────

export const calibrationSchema = z
  .object({
    outliers: z.array(z.string().min(1)).max(10),
    inconsistency_flags: z.array(z.string().min(1)).max(10),
    talking_points: z.array(z.string().min(1)).min(1).max(8),
  })
  .strict();

export const calibrationJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    outliers: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 10,
    },
    inconsistency_flags: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 10,
    },
    talking_points: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 1,
      maxItems: 8,
    },
  },
  required: ['outliers', 'inconsistency_flags', 'talking_points'],
  additionalProperties: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// mid-year-nudges (T10)
// ─────────────────────────────────────────────────────────────────────────────

export const midYearNudgesSchema = z
  .object({
    per_kra_nudge: z
      .array(
        z
          .object({
            kra_id: z.string().min(1),
            nudge: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    overall_focus: z.string().min(1).max(1000),
  })
  .strict();

export const midYearNudgesJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    per_kra_nudge: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kra_id: { type: 'string', minLength: 1 },
          nudge: { type: 'string', minLength: 1, maxLength: 500 },
        },
        required: ['kra_id', 'nudge'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 10,
    },
    overall_focus: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['per_kra_nudge', 'overall_focus'],
  additionalProperties: false,
};
