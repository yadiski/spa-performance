import { api } from './client';

export interface ExportJobRow {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  params: Record<string, unknown>;
  rowCount: number | null;
  sha256: string | null;
  error: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ExportJobDetail extends ExportJobRow {
  url?: string;
  expiresAt?: string;
}

export interface ExportListResponse {
  items: ExportJobRow[];
  limit: number;
  offset: number;
}

export const exportsApi = {
  /** Enqueue an org-wide PMS snapshot export. HRA only. */
  enqueuePmsOrg: (opts: { fy?: number } = {}) =>
    api<{ id: string; status: 'queued' }>('/api/v1/exports/pms-org', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  /** Get a single export job by id. Includes signed URL when ready. */
  get: (id: string) => api<ExportJobDetail>(`/api/v1/exports/${id}`),

  /** List export jobs. HRA sees all; others see their own. */
  list: (opts: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return api<ExportListResponse>(`/api/v1/exports${qs ? `?${qs}` : ''}`);
  },
};
