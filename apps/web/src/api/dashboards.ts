import { api } from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MyCycleItem {
  id: string;
  fy: number;
  state: string;
  scoreTotal: number | null;
  trajectoryJune: number | null;
  trajectoryNow: number | null;
}

export interface MeDashboardResponse {
  cycles: MyCycleItem[];
}

export interface TeamDirectReport {
  staffId: string;
  name: string;
  employeeNo: string;
  currentCycleState: string | null;
  scoreTotal: number | null;
  trajectoryJune: number | null;
  trajectoryNow: number | null;
}

export interface TeamPendingAction {
  cycleId: string;
  staffName: string;
  action: string;
}

export interface TeamDashboardResponse {
  directReports: TeamDirectReport[];
  pendingActions: TeamPendingAction[];
  stats: {
    total: number;
    completed: number;
    inProgress: number;
  };
}

export interface DeptRollup {
  totalCycles: number;
  finalizedCycles: number;
  avgScore: number | null;
}

export interface DeptDistributionBucket {
  bucket: string;
  count: number;
}

export interface DeptCycleRow {
  cycleId: string;
  staffName: string;
  state: string;
  scoreTotal: number | null;
}

export interface DeptDashboardResponse {
  department: { id: string; name: string };
  rollup: DeptRollup;
  distribution: DeptDistributionBucket[];
  cycles: DeptCycleRow[];
}

export interface HrDeptRow {
  id: string;
  name: string;
  totalCycles: number;
  finalizedCycles: number;
  avgScore: number | null;
}

export interface HrDashboardResponse {
  rollup: DeptRollup;
  stateCounts: Record<string, number>;
  departments: HrDeptRow[];
}

// ── API wrappers ──────────────────────────────────────────────────────────────

export const dashboardsApi = {
  /** Actor's own cycle summaries with trajectory data. */
  me: () => api<MeDashboardResponse>('/api/v1/dashboards/me'),

  /** Direct-reports summary for the acting manager. */
  team: () => api<TeamDashboardResponse>('/api/v1/dashboards/team'),

  /** Department dashboard (requires department_head or HRA role). */
  dept: () => api<DeptDashboardResponse>('/api/v1/dashboards/dept'),

  /** Org-wide dashboard (HRA only). */
  hr: () => api<HrDashboardResponse>('/api/v1/dashboards/hr'),
};
