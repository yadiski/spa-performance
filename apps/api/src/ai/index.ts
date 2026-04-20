// AI feature barrel — re-exports all public-facing functions and types.
// Route wrappers (T11-T17) will import from here.

export { runStaffSummary } from './features/staff-summary';
export type { StaffSummaryInput, StaffSummaryOutput } from './features/staff-summary';

export { runKraQuality } from './features/kra-quality';
export type { KraQualityInput, KraQualityOutput } from './features/kra-quality';

export { runDevRecommendations } from './features/dev-recommendations';
export type {
  DevRecommendationsInput,
  DevRecommendationsOutput,
} from './features/dev-recommendations';

export { runCalibration } from './features/calibration';
export type {
  CalibrationInput,
  CalibrationOutput,
  CalibrationPeerRating,
} from './features/calibration';

export { runMidYearNudges } from './features/mid-year-nudges';
export type {
  MidYearNudgesInput,
  MidYearNudgesOutput,
  KraProgress,
} from './features/mid-year-nudges';

// Core re-exports for convenience
export type { DispatchResult } from './core/dispatch';
export { redactPII } from './core/redact';
export type { RedactOptions, RedactResult } from './core/redact';
