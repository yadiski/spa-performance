import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/_app/admin/access-review')({
  component: AccessReviewPage,
});

interface Cycle {
  id: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  status: 'pending' | 'in_progress' | 'completed';
  completed_at: string | null;
}

interface Snapshot {
  email: string;
  name: string;
  roles: string[];
  lastLoginAt: string | null;
  rolesUnchangedDays: number;
}

interface ReviewItem {
  id: string;
  user_id: string;
  snapshot: Snapshot;
  decision: 'approved' | 'revoked' | 'deferred' | null;
  decision_reason: string | null;
  decided_at: string | null;
}

async function fetchCycles(): Promise<{ cycles: Cycle[] }> {
  const res = await fetch('/api/v1/admin/access-review/cycles', { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchItems(cycleId: string, decision: string): Promise<{ items: ReviewItem[] }> {
  const qs = `decision=${encodeURIComponent(decision)}&limit=200`;
  const res = await fetch(`/api/v1/admin/access-review/cycles/${cycleId}/items?${qs}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postDecision(
  itemId: string,
  decision: 'approved' | 'revoked' | 'deferred',
  reason?: string,
): Promise<void> {
  const res = await fetch(`/api/v1/admin/access-review/items/${itemId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ decision, reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error((body as { message?: string }).message ?? 'Request failed');
  }
}

function formatDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function DecisionButtons({
  item,
  onDecide,
}: {
  item: ReviewItem;
  onDecide: (id: string, decision: 'approved' | 'revoked' | 'deferred', reason?: string) => void;
}) {
  const [revokeMode, setRevokeMode] = useState(false);
  const [reason, setReason] = useState('');

  if (item.decision) {
    return (
      <span
        className={`text-xs px-2 py-0.5 rounded font-medium ${
          item.decision === 'approved'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : item.decision === 'revoked'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
        }`}
      >
        {item.decision}
      </span>
    );
  }

  if (revokeMode) {
    return (
      <div className="space-y-2 min-w-[240px]">
        <textarea
          className="w-full border border-hairline rounded-sm px-2 py-1 text-xs resize-none"
          rows={2}
          placeholder="Reason for revocation (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => onDecide(item.id, 'revoked', reason.trim())}
            className="text-xs px-2 py-1 bg-red-600 text-white rounded-sm disabled:opacity-50"
          >
            Confirm revoke
          </button>
          <button
            type="button"
            onClick={() => setRevokeMode(false)}
            className="text-xs px-2 py-1 border border-hairline rounded-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => onDecide(item.id, 'approved')}
        className="text-xs px-2 py-1 bg-green-600 text-white rounded-sm hover:bg-green-700"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() => setRevokeMode(true)}
        className="text-xs px-2 py-1 bg-red-600 text-white rounded-sm hover:bg-red-700"
      >
        Revoke
      </button>
      <button
        type="button"
        onClick={() => onDecide(item.id, 'deferred')}
        className="text-xs px-2 py-1 border border-hairline rounded-sm hover:bg-surface"
      >
        Defer
      </button>
    </div>
  );
}

function AccessReviewPage() {
  const qc = useQueryClient();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('pending');
  const [decideError, setDecideError] = useState<string | null>(null);

  const cyclesQ = useQuery({
    queryKey: ['access-review-cycles'],
    queryFn: fetchCycles,
  });

  const cycles = cyclesQ.data?.cycles ?? [];
  const activeCycleId = selectedCycleId ?? cycles[0]?.id ?? null;

  const itemsQ = useQuery({
    queryKey: ['access-review-items', activeCycleId, filter],
    queryFn: () => fetchItems(activeCycleId!, filter),
    enabled: !!activeCycleId,
  });

  const decideMut = useMutation({
    mutationFn: ({
      itemId,
      decision,
      reason,
    }: {
      itemId: string;
      decision: 'approved' | 'revoked' | 'deferred';
      reason?: string;
    }) => postDecision(itemId, decision, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-review-items'] });
      qc.invalidateQueries({ queryKey: ['access-review-cycles'] });
      setDecideError(null);
    },
    onError: (err) => setDecideError(err.message),
  });

  function handleDecide(
    itemId: string,
    decision: 'approved' | 'revoked' | 'deferred',
    reason?: string,
  ) {
    decideMut.mutate({ itemId, decision, ...(reason !== undefined ? { reason } : {}) });
  }

  const currentCycle = cycles.find((c) => c.id === activeCycleId);
  const items = itemsQ.data?.items ?? [];

  const summary = {
    approved: items.filter((i) => i.decision === 'approved').length,
    revoked: items.filter((i) => i.decision === 'revoked').length,
    deferred: items.filter((i) => i.decision === 'deferred').length,
    pending: items.filter((i) => !i.decision).length,
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Quarterly Access Review</h1>
        <p className="text-xs text-ink-2 mt-1">
          Review user access, roles, and last login. Approve, revoke, or defer each entry. Complete
          within 30 days of generation.
        </p>
      </div>

      {/* Cycle selector */}
      {cycles.length > 0 && (
        <div className="flex items-center gap-3">
          <label htmlFor="cycle-select" className="text-xs text-ink-2 font-medium">
            Cycle:
          </label>
          <select
            id="cycle-select"
            className="border border-hairline rounded-sm px-2 py-1 text-sm bg-canvas"
            value={activeCycleId ?? ''}
            onChange={(e) => setSelectedCycleId(e.target.value)}
          >
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.period_start} — {c.period_end} ({c.status})
              </option>
            ))}
          </select>
        </div>
      )}

      {currentCycle && (
        <div className="bg-surface border border-hairline rounded-md px-5 py-4 space-y-2">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-ink-2">Period: </span>
              <span className="text-ink font-medium">
                {formatDate(currentCycle.period_start)} – {formatDate(currentCycle.period_end)}
              </span>
            </div>
            <div>
              <span className="text-ink-2">Status: </span>
              <span
                className={`font-medium ${
                  currentCycle.status === 'completed'
                    ? 'text-green-700'
                    : currentCycle.status === 'in_progress'
                      ? 'text-amber-700'
                      : 'text-ink'
                }`}
              >
                {currentCycle.status}
              </span>
            </div>
            <div>
              <span className="text-ink-2">Generated: </span>
              <span className="text-ink">{formatDate(currentCycle.generated_at)}</span>
            </div>
          </div>
          <div className="flex gap-4 text-xs text-ink-2 pt-1">
            <span className="text-green-700">Approved: {summary.approved}</span>
            <span className="text-red-700">Revoked: {summary.revoked}</span>
            <span className="text-amber-700">Deferred: {summary.deferred}</span>
            <span>Pending: {summary.pending}</span>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {(['pending', 'approved', 'revoked', 'deferred', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f === 'all' ? '' : f)}
            className={`text-xs px-3 py-1 rounded-sm border transition-colors ${
              (filter === '' ? 'all' : filter) === f
                ? 'bg-ink text-white border-ink'
                : 'border-hairline bg-canvas hover:bg-surface'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {decideError && (
        <div className="bg-red-50 border border-red-200 rounded-md px-4 py-2 text-sm text-red-700">
          {decideError}
        </div>
      )}

      {/* Items table */}
      {cyclesQ.isLoading || itemsQ.isLoading ? (
        <p className="text-sm text-ink-2">Loading...</p>
      ) : cycles.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-md px-5 py-8 text-center text-sm text-ink-2">
          No access review cycles have been generated yet. The quarterly cron runs on the 1st of
          January, April, July, and October.
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-md px-5 py-8 text-center text-sm text-ink-2">
          No items matching this filter.
        </div>
      ) : (
        <div className="border border-hairline rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface border-b border-hairline">
              <tr>
                <th className="text-left px-4 py-2 text-xs text-ink-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 text-xs text-ink-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 text-xs text-ink-2 font-medium">Roles</th>
                <th className="text-left px-4 py-2 text-xs text-ink-2 font-medium">Last login</th>
                <th className="text-left px-4 py-2 text-xs text-ink-2 font-medium">
                  Days unchanged
                </th>
                <th className="text-left px-4 py-2 text-xs text-ink-2 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3 text-ink">{item.snapshot.name}</td>
                  <td className="px-4 py-3 text-ink-2">{item.snapshot.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.snapshot.roles.length > 0 ? (
                        item.snapshot.roles.map((r) => (
                          <span
                            key={r}
                            className="text-xs px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded text-indigo-700"
                          >
                            {r}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-ink-2">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{formatDate(item.snapshot.lastLoginAt)}</td>
                  <td className="px-4 py-3 text-ink-2">
                    <span
                      className={
                        item.snapshot.rolesUnchangedDays > 365 ? 'text-amber-700 font-medium' : ''
                      }
                    >
                      {item.snapshot.rolesUnchangedDays}d
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <DecisionButtons item={item} onDecide={handleDecide} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
