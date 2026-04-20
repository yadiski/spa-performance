import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { type BatchRow, type StageBatchResult, staffImportApi } from '../../../api/staff-import';

export const Route = createFileRoute('/_app/hr/staff-import')({
  component: StaffImportPage,
});

function statusBadge(status: BatchRow['status']) {
  const classes: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    validated: 'bg-blue-50 text-blue-700 border-blue-200',
    applied: 'bg-green-50 text-green-700 border-green-200',
    reverted: 'bg-slate-50 text-slate-600 border-slate-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded-sm border ${classes[status] ?? 'bg-canvas border-hairline text-ink-2'}`}
    >
      {status}
    </span>
  );
}

function canRevert(batch: BatchRow): boolean {
  if (batch.status !== 'applied' || !batch.applied_at) return false;
  const elapsed = Date.now() - new Date(batch.applied_at).getTime();
  return elapsed < 24 * 60 * 60 * 1000;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function StaffImportPage() {
  const qc = useQueryClient();

  // orgId comes from query string or a fallback
  const search = useSearch({ strict: false }) as { orgId?: string };
  const orgId: string = (search as { orgId?: string }).orgId ?? '';

  const [csv, setCsv] = useState('');
  const [stageResult, setStageResult] = useState<StageBatchResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const batchesQ = useQuery({
    queryKey: ['staff-import', 'batches', orgId],
    queryFn: () => staffImportApi.batches(orgId),
    enabled: !!orgId,
  });

  const stageMut = useMutation({
    mutationFn: () => staffImportApi.stage(orgId, csv),
    onSuccess: (data) => {
      setStageResult(data);
      qc.invalidateQueries({ queryKey: ['staff-import', 'batches', orgId] });
      if (data.errors.length === 0) showToast('CSV validated — ready to apply.');
      else showToast(`Validation completed with ${data.errors.length} error(s).`);
    },
    onError: (err: Error) => showToast(`Stage failed: ${err.message}`),
  });

  const applyMut = useMutation({
    mutationFn: (batchId: string) => staffImportApi.apply(batchId),
    onSuccess: (data) => {
      setStageResult(null);
      setCsv('');
      qc.invalidateQueries({ queryKey: ['staff-import', 'batches', orgId] });
      showToast(`Applied — ${data.created} created, ${data.updated} updated.`);
    },
    onError: (err: Error) => showToast(`Apply failed: ${err.message}`),
  });

  const revertMut = useMutation({
    mutationFn: (batchId: string) => staffImportApi.revert(batchId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['staff-import', 'batches', orgId] });
      showToast(`Reverted ${data.reverted} row(s).`);
    },
    onError: (err: Error) => showToast(`Revert failed: ${err.message}`),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsv((ev.target?.result as string) ?? '');
    reader.readAsText(file);
  };

  const canApply = stageResult != null && stageResult.errors.length === 0 && !applyMut.isPending;

  return (
    <div className="max-w-4xl space-y-8">
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded bg-ink px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-lg font-semibold text-ink">Staff Bulk Import</h1>
        <p className="mt-1 text-sm text-ink-2">
          Upload a CSV file or paste CSV content to stage, validate, and apply a bulk staff import.
        </p>
      </div>

      {!orgId && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Pass <code>?orgId=...</code> in the URL to enable this page.
        </div>
      )}

      {orgId && (
        <>
          {/* ── CSV input ─────────────────────────────────────────────────── */}
          <div className="space-y-3 rounded border border-hairline bg-canvas p-4">
            <h2 className="text-sm font-medium text-ink">1. Provide CSV</h2>

            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="rounded border border-hairline bg-white px-3 py-1.5 text-sm text-ink hover:bg-canvas"
                onClick={() => fileRef.current?.click()}
              >
                Choose file
              </button>
              <span className="text-xs text-ink-2">or paste below</span>
            </div>

            <textarea
              className="w-full rounded border border-hairline bg-white px-3 py-2 font-mono text-xs text-ink"
              rows={8}
              placeholder="employee_no,email,name,designation,department_code,grade_code,manager_employee_no,hire_date,roles"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                type="button"
                disabled={!csv.trim() || stageMut.isPending}
                className="rounded bg-ink px-4 py-1.5 text-sm text-white disabled:opacity-40"
                onClick={() => stageMut.mutate()}
              >
                {stageMut.isPending ? 'Staging…' : 'Stage'}
              </button>

              {canApply && (
                <button
                  type="button"
                  disabled={applyMut.isPending}
                  className="rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
                  onClick={() => applyMut.mutate(stageResult!.batchId)}
                >
                  {applyMut.isPending ? 'Applying…' : 'Apply'}
                </button>
              )}
            </div>
          </div>

          {/* ── Validation result ─────────────────────────────────────────── */}
          {stageResult && (
            <div className="space-y-3 rounded border border-hairline bg-canvas p-4">
              <h2 className="text-sm font-medium text-ink">2. Validation result</h2>
              <p className="text-sm text-ink-2">
                Batch ID: <span className="font-mono text-xs">{stageResult.batchId}</span>{' '}
                &nbsp;|&nbsp;
                {stageResult.rowCount} row(s)
              </p>

              {stageResult.errors.length === 0 ? (
                <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  All rows valid. Click <strong>Apply</strong> to commit.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-hairline">
                        <th className="px-2 py-1 text-left font-medium text-ink-2">Row</th>
                        <th className="px-2 py-1 text-left font-medium text-ink-2">Column</th>
                        <th className="px-2 py-1 text-left font-medium text-ink-2">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stageResult.errors.map((e, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: stable list
                        <tr key={i} className="border-b border-hairline last:border-0">
                          <td className="px-2 py-1 font-mono text-ink">{e.row}</td>
                          <td className="px-2 py-1 text-ink-2">{e.column ?? '—'}</td>
                          <td className="px-2 py-1 text-red-700">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Batch history ─────────────────────────────────────────────── */}
          <div className="space-y-3 rounded border border-hairline bg-canvas p-4">
            <h2 className="text-sm font-medium text-ink">Import history</h2>

            {batchesQ.isLoading && <p className="text-sm text-ink-2">Loading…</p>}

            {batchesQ.data && batchesQ.data.batches.length === 0 && (
              <p className="text-sm text-ink-2">No imports yet.</p>
            )}

            {batchesQ.data && batchesQ.data.batches.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className="px-2 py-1 text-left font-medium text-ink-2">Created</th>
                      <th className="px-2 py-1 text-left font-medium text-ink-2">Rows</th>
                      <th className="px-2 py-1 text-left font-medium text-ink-2">Status</th>
                      <th className="px-2 py-1 text-left font-medium text-ink-2">Applied</th>
                      <th className="px-2 py-1 text-left font-medium text-ink-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchesQ.data.batches.map((batch) => (
                      <tr key={batch.id} className="border-b border-hairline last:border-0">
                        <td className="px-2 py-1 text-ink">{relativeTime(batch.created_at)}</td>
                        <td className="px-2 py-1 text-ink">{batch.row_count}</td>
                        <td className="px-2 py-1">{statusBadge(batch.status)}</td>
                        <td className="px-2 py-1 text-ink-2">{relativeTime(batch.applied_at)}</td>
                        <td className="px-2 py-1">
                          {canRevert(batch) && (
                            <button
                              type="button"
                              disabled={revertMut.isPending}
                              className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100 disabled:opacity-40"
                              onClick={() => revertMut.mutate(batch.id)}
                            >
                              Revert
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
