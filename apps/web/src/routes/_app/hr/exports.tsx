import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { type ExportJobRow, exportsApi } from '../../../api/exports';

export const Route = createFileRoute('/_app/hr/exports')({
  component: HrExportsPage,
});

function statusBadge(status: ExportJobRow['status']) {
  const classes: Record<string, string> = {
    queued: 'bg-amber-50 text-amber-700 border-amber-200',
    running: 'bg-blue-50 text-blue-700 border-blue-200',
    ready: 'bg-green-50 text-green-700 border-green-200',
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

function HrExportsPage() {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['exports', 'list'],
    queryFn: () => exportsApi.list({ limit: 20 }),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActiveJob = items.some((j) => j.status === 'queued' || j.status === 'running');
      return hasActiveJob ? 10_000 : false;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => {
      const now = new Date();
      // Use current calendar year as fiscal year (adjust if org uses different FY)
      const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      return exportsApi.enqueuePmsOrg({ fy });
    },
    onSuccess: () => {
      setToast('Export queued — the file will be ready in a moment.');
      qc.invalidateQueries({ queryKey: ['exports'] });
      setTimeout(() => setToast(null), 5000);
    },
    onError: () => {
      setToast('Failed to queue export. Please try again.');
      setTimeout(() => setToast(null), 5000);
    },
  });

  async function handleDownload(jobId: string) {
    try {
      const detail = await exportsApi.get(jobId);
      if (detail.url) {
        window.location.href = detail.url;
      }
    } catch {
      // silently ignore — row may have refreshed
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Exports</h1>
        <p className="text-xs text-ink-2 mt-1">
          Generate and download org-wide PMS snapshots as Excel files.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="bg-surface border border-hairline rounded-md px-4 py-3 text-sm text-ink">
          {toast}
        </div>
      )}

      {/* Trigger */}
      <div className="bg-surface border border-hairline rounded-md p-5 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-ink">Export org PMS snapshot (current FY)</div>
          <div className="text-xs text-ink-2 mt-1">
            Generates an Excel workbook with one row per finalized cycle for the current fiscal
            year.
          </div>
        </div>
        <button
          type="button"
          onClick={() => triggerMutation.mutate()}
          disabled={triggerMutation.isPending}
          className="shrink-0 text-sm border border-hairline rounded-sm px-3 py-1.5 bg-canvas hover:bg-surface transition-colors disabled:opacity-50"
        >
          {triggerMutation.isPending ? 'Queuing…' : 'Generate export'}
        </button>
      </div>

      {/* History table */}
      <div>
        <h2 className="text-sm font-semibold text-ink mb-3">Export history</h2>

        {isLoading ? (
          <div className="text-xs text-ink-2">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-ink-2">No exports yet.</div>
        ) : (
          <div className="bg-surface border border-hairline rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Kind
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Params
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Status
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Rows
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Requested
                  </th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {items.map((job) => (
                  <tr key={job.id} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-2.5 text-ink text-xs font-mono">{job.kind}</td>
                    <td className="px-4 py-2.5 text-ink-2 text-xs">
                      {job.params && Object.keys(job.params).length > 0
                        ? JSON.stringify(job.params)
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5">{statusBadge(job.status)}</td>
                    <td
                      className="px-4 py-2.5 text-right text-ink-2"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {job.rowCount ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-ink-2 text-xs">
                      {relativeTime(job.requestedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {job.status === 'ready' && (
                        <button
                          type="button"
                          onClick={() => handleDownload(job.id)}
                          className="text-xs text-ink border border-hairline rounded-sm px-2 py-0.5 hover:bg-canvas transition-colors"
                        >
                          Download
                        </button>
                      )}
                      {job.status === 'failed' && (
                        <span className="text-xs text-red-600" title={job.error ?? ''}>
                          Error
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
