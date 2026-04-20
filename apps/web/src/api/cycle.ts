import { api } from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CycleState =
  | 'kra_drafting'
  | 'kra_pending_approval'
  | 'kra_approved'
  | 'mid_year_open'
  | 'mid_year_submitted'
  | 'mid_year_done'
  | 'pms_self_review'
  | 'pms_awaiting_appraiser'
  | 'pms_awaiting_next_lvl'
  | 'pms_awaiting_hra'
  | 'pms_finalized';

export const ALL_CYCLE_STATES: CycleState[] = [
  'kra_drafting',
  'kra_pending_approval',
  'kra_approved',
  'mid_year_open',
  'mid_year_submitted',
  'mid_year_done',
  'pms_self_review',
  'pms_awaiting_appraiser',
  'pms_awaiting_next_lvl',
  'pms_awaiting_hra',
  'pms_finalized',
];

/** State eligible for the "open mid-year window" transition (hra action). */
export const MID_YEAR_ELIGIBLE_STATE: CycleState = 'kra_approved';
/** State eligible for the "open PMS window" transition (hra action). */
export const PMS_ELIGIBLE_STATE: CycleState = 'mid_year_done';
/** States where HRA finalize page is relevant. */
export const HRA_FINALIZE_STATES = new Set<CycleState>(['pms_awaiting_hra', 'pms_finalized']);

export interface CycleListItem {
  id: string;
  staffId: string;
  staffName: string;
  departmentId: string;
  departmentName: string;
  employeeNo: string;
  fy: number;
  state: CycleState;
  midYearAt: string | null;
  pmsFinalizedAt: string | null;
  updatedAt: string;
}

export interface CycleListResponse {
  items: CycleListItem[];
  total: number;
}

export interface DepartmentItem {
  id: string;
  name: string;
  code: string;
}

export interface OrgStaffItem {
  id: string;
  name: string;
  employeeNo: string;
  departmentId: string;
}

export interface BulkResult {
  opened: number;
  failed: Array<{ cycleId: string; error: string }>;
}

// ── Query params for cycle list ───────────────────────────────────────────────

export interface CycleListParams {
  state?: CycleState;
  fy?: number;
  staffId?: string;
  departmentId?: string;
  limit?: number;
  offset?: number;
}

// ── Bulk scope ────────────────────────────────────────────────────────────────

export type BulkScope =
  | { scope: 'org' }
  | { scope: 'department'; departmentId: string }
  | { scope: 'staffIds'; staffIds: string[] };

// ── cycleApi ──────────────────────────────────────────────────────────────────

export const cycleApi = {
  // ── List ──────────────────────────────────────────────────────────────────

  /** List all cycles visible to the actor. HRA sees org-wide; others see own. */
  list: (params: CycleListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.state) qs.set('state', params.state);
    if (params.fy != null) qs.set('fy', String(params.fy));
    if (params.staffId) qs.set('staffId', params.staffId);
    if (params.departmentId) qs.set('departmentId', params.departmentId);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return api<CycleListResponse>(`/api/v1/cycle/list${q ? `?${q}` : ''}`);
  },

  /** List departments for the actor's org (HRA only). */
  getDepartments: () => api<{ items: DepartmentItem[] }>('/api/v1/cycle/departments'),

  /** List all staff in the actor's org for the bulk picker (HRA only). */
  getOrgStaff: () => api<{ items: OrgStaffItem[] }>('/api/v1/cycle/org-staff'),

  // ── Per-staff window openers (HRA only) ────────────────────────────────────

  openPmsForStaff: (cycleId: string) =>
    api<{ ok: boolean; error?: string }>('/api/v1/cycle/open-pms-for-staff', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  openMidYearForStaff: (cycleId: string) =>
    api<{ ok: boolean; error?: string }>('/api/v1/cycle/open-mid-year-for-staff', {
      method: 'POST',
      body: JSON.stringify({ cycleId }),
    }),

  // ── Bulk window openers (HRA only) ─────────────────────────────────────────

  openPmsBulk: (scope: BulkScope) =>
    api<BulkResult>('/api/v1/cycle/open-pms-bulk', {
      method: 'POST',
      body: JSON.stringify(scope),
    }),

  openMidYearBulk: (scope: BulkScope) =>
    api<BulkResult>('/api/v1/cycle/open-mid-year-bulk', {
      method: 'POST',
      body: JSON.stringify(scope),
    }),
};
