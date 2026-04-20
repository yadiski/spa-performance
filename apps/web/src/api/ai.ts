import { api } from './client';

// ── Output types ──────────────────────────────────────────────────────────────

export interface StaffSummaryOutput {
  highlights: string[];
  concerns: string[];
  focus_areas: string[];
}

export interface KraQualityOutput {
  smart_score: number;
  issues: string[];
  suggested_rewrite: string;
}

export interface DevRecommendationsOutput {
  training: string[];
  stretch: string[];
  mentorship: string[];
}

export interface CalibrationOutput {
  outliers: string[];
  inconsistency_flags: string[];
  talking_points: string[];
}

export interface MidYearNudgesOutput {
  per_kra_nudge: Array<{ kra_id: string; nudge: string }>;
  overall_focus: string;
}

export interface UsageToday {
  promptTokens: number;
  completionTokens: number;
  requests: number;
  dailyCap: number;
  usagePct: number;
}

export interface CalibrationCohort {
  gradeId: string;
  gradeCode: string;
  gradeRank: string;
  fy: number;
  cycleCount: number;
  avgScore: number | null;
}

// ── API wrapper ───────────────────────────────────────────────────────────────

export const aiApi = {
  staffSummary: (cycleId: string) =>
    api<{ ok: true; output: StaffSummaryOutput }>('/api/v1/ai/staff-summary', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  kraQuality: (kraId: string) =>
    api<{ ok: true; output: KraQualityOutput }>('/api/v1/ai/kra-quality', {
      method: 'POST',
      body: JSON.stringify({ kraId }),
    }),

  devRecommendations: (cycleId: string) =>
    api<{ ok: true; output: DevRecommendationsOutput }>('/api/v1/ai/dev-recommendations', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  calibration: (gradeId: string, fy: number) =>
    api<{ ok: true; output: CalibrationOutput }>('/api/v1/ai/calibration', {
      method: 'POST',
      body: JSON.stringify({ gradeId, fy }),
    }),

  midYearNudges: (cycleId: string) =>
    api<{ ok: true; output: MidYearNudgesOutput }>('/api/v1/ai/mid-year-nudges', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  usageToday: () => api<UsageToday>('/api/v1/ai/usage-today'),

  calibrationCohorts: (fy: number) =>
    api<{ items: CalibrationCohort[] }>(`/api/v1/ai/calibration-cohorts?fy=${fy}`),
};
