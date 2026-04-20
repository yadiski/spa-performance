// AI feature output types — shared between API and UI.
// These are plain TypeScript types (no Zod runtime dependency).

// ─────────────────────────────────────────────────────────────────────────────
// staff-summary
// ─────────────────────────────────────────────────────────────────────────────

export interface StaffSummaryOutput {
  highlights: string[];
  concerns: string[];
  focus_areas: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// kra-quality
// ─────────────────────────────────────────────────────────────────────────────

export interface KraQualityOutput {
  smart_score: number;
  issues: string[];
  suggested_rewrite: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// dev-recommendations
// ─────────────────────────────────────────────────────────────────────────────

export interface DevRecommendationsOutput {
  training: string[];
  stretch: string[];
  mentorship: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// calibration
// ─────────────────────────────────────────────────────────────────────────────

export interface CalibrationOutput {
  outliers: string[];
  inconsistency_flags: string[];
  talking_points: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// mid-year-nudges
// ─────────────────────────────────────────────────────────────────────────────

export interface MidYearNudgeItem {
  kra_id: string;
  nudge: string;
}

export interface MidYearNudgesOutput {
  per_kra_nudge: MidYearNudgeItem[];
  overall_focus: string;
}
