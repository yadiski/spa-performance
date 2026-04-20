import { api } from './client';

export interface ValidationError {
  row: number;
  column?: string;
  message: string;
}

export interface StageBatchResult {
  batchId: string;
  csvHash: string;
  rowCount: number;
  errors: ValidationError[];
}

export interface BatchRow {
  id: string;
  org_id: string;
  csv_hash: string;
  row_count: number;
  status: 'pending' | 'validated' | 'applied' | 'reverted' | 'failed';
  validation_errors: ValidationError[];
  created_at: string;
  applied_at: string | null;
  reverted_at: string | null;
}

export const staffImportApi = {
  stage: (orgId: string, csv: string) =>
    api<StageBatchResult>('/api/v1/staff/import/stage', {
      method: 'POST',
      body: JSON.stringify({ orgId, csv }),
    }),

  apply: (batchId: string) =>
    api<{ ok: true; created: number; updated: number }>('/api/v1/staff/import/apply', {
      method: 'POST',
      body: JSON.stringify({ batchId }),
    }),

  revert: (batchId: string) =>
    api<{ ok: true; reverted: number }>('/api/v1/staff/import/revert', {
      method: 'POST',
      body: JSON.stringify({ batchId }),
    }),

  batches: (orgId: string) =>
    api<{ batches: BatchRow[] }>(`/api/v1/staff/import/batches?orgId=${encodeURIComponent(orgId)}`),
};
