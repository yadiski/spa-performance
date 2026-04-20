import { api } from './client';

// ── Types returned by GET /api/v1/pms/:cycleId/state ─────────────────────────

export interface PmsCycleInfo {
  id: string;
  state: string;
  staffId: string;
  fy: number;
}

export interface PmsKraRatingRow {
  kraId: string;
  selfRating: number | null;
  finalRating: number | null;
  resultAchieved: string | null;
}

export interface PmsBehaviouralRow {
  dimensionCode: string;
  rating: number;
  anchorText: string;
}

export interface PmsContributionRow {
  id: string;
  whenDate: string;
  achievement: string;
  weightPct: number;
}

export interface PmsCareerRow {
  potentialWindow: string;
  notes: string | null;
}

export interface PmsGrowthRow {
  goals: string | null;
  notes: string | null;
}

export interface PmsCommentRow {
  role: string;
  body: string;
  signedBy: string | null;
  signedAt: string | null;
}

export interface PmsState {
  cycle: PmsCycleInfo;
  pms: { id: string } | null;
  kraRatings: PmsKraRatingRow[];
  behavioural: PmsBehaviouralRow[];
  contributions: PmsContributionRow[];
  career: PmsCareerRow | null;
  growth: PmsGrowthRow | null;
  comments: PmsCommentRow[];
}

// ── Types for GET /api/v1/pms/behavioural-dimensions ─────────────────────────

export interface BehaviouralDimensionItem {
  code: string;
  title: string;
  description: string;
  order: number;
  anchors: string[]; // length 5
}

export interface BehaviouralDimensionsResponse {
  items: BehaviouralDimensionItem[];
}

// ── Types for scoring ─────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  kra: number;
  behavioural: number;
  contribution: number;
  total: number;
}

// ── pmsApi ────────────────────────────────────────────────────────────────────

export const pmsApi = {
  /** Full PMS form state for a given cycle (appraisee/appraiser/next-level/HRA). */
  getState: (cycleId: string) => api<PmsState>(`/api/v1/pms/${cycleId}/state`),

  /** All 22 behavioural dimension rubrics, ordered. */
  getBehaviouralDimensions: () =>
    api<BehaviouralDimensionsResponse>('/api/v1/pms/behavioural-dimensions'),

  /** Computed score breakdown. */
  getScore: (cycleId: string) => api<{ breakdown: ScoreBreakdown }>(`/api/v1/pms/${cycleId}/score`),

  /** PDF download URL (async — may be PDF_NOT_READY). */
  getPdfUrl: (cycleId: string) =>
    api<{ url: string; expiresAt: string }>(`/api/v1/pms/${cycleId}/pdf`),

  // ── Save endpoints ──────────────────────────────────────────────────────────

  saveKraRatings: (body: {
    cycleId: string;
    ratings: Array<{
      kraId: string;
      resultAchieved: string;
      finalRating: number;
      comment?: string;
    }>;
  }) =>
    api<{ ok: true }>('/api/v1/pms/kra-ratings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  saveBehavioural: (body: {
    cycleId: string;
    ratings: Array<{
      dimensionCode: string;
      rating1to5: number;
      rubricAnchorText: string;
      comment?: string;
    }>;
  }) =>
    api<{ ok: true }>('/api/v1/pms/behavioural', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  saveContributions: (body: {
    cycleId: string;
    contributions: Array<{ whenDate: string; achievement: string; weightPct: number }>;
  }) =>
    api<{ ok: true }>('/api/v1/pms/contributions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  saveCareer: (body: {
    cycleId: string;
    potentialWindow: string;
    readyIn?: string | undefined;
    comments?: string | undefined;
  }) =>
    api<{ ok: true }>('/api/v1/pms/career', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  saveGrowth: (body: {
    cycleId: string;
    trainingNeeds?: string | undefined;
    comments?: string | undefined;
  }) =>
    api<{ ok: true }>('/api/v1/pms/growth', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  saveComment: (body: { cycleId: string; role: string; body: string }) =>
    api<{ ok: true }>('/api/v1/pms/comment', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── Transition endpoints ────────────────────────────────────────────────────

  submitSelfReview: (cycleId: string) =>
    api<{ ok: true }>('/api/v1/pms/submit-self-review', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  submitAppraiser: (cycleId: string) =>
    api<{ ok: true }>('/api/v1/pms/submit-appraiser', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  submitNextLevel: (cycleId: string) =>
    api<{ ok: true }>('/api/v1/pms/submit-next-level', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  returnToAppraisee: (cycleId: string, note?: string) =>
    api<{ ok: true }>('/api/v1/pms/return-to-appraisee', {
      method: 'POST',
      body: JSON.stringify({ cycleId, note }),
    }),

  returnToAppraiser: (cycleId: string, note?: string) =>
    api<{ ok: true }>('/api/v1/pms/return-to-appraiser', {
      method: 'POST',
      body: JSON.stringify({ cycleId, note }),
    }),

  finalize: (cycleId: string) =>
    api<{ ok: true }>('/api/v1/pms/finalize', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  reopen: (cycleId: string, reason: string) =>
    api<{ ok: true }>('/api/v1/pms/reopen', {
      method: 'POST',
      body: JSON.stringify({ cycleId, reason }),
    }),
};
