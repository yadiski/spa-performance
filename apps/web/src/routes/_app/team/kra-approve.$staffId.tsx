import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../../../api/client';

export const Route = createFileRoute('/_app/team/kra-approve/$staffId')({ component: KraApprove });

type KraRow = {
  id: string;
  description: string;
  weightPct: number;
  perspective: string;
  measurement: string;
  target: string;
};

function KraApprove() {
  const { staffId } = Route.useParams();
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const cycle = useQuery({
    queryKey: ['cycle', 'for-staff', staffId],
    queryFn: () =>
      api<{ cycle: { id: string; state: string } | null }>(`/api/v1/cycle/for-staff/${staffId}`),
  });

  const kras = useQuery({
    queryKey: ['kras', cycle.data?.cycle?.id],
    queryFn: () => api<{ kras: KraRow[] }>(`/api/v1/kra/${cycle.data!.cycle!.id}`),
    enabled: !!cycle.data?.cycle?.id,
  });

  const approve = useMutation({
    mutationFn: () =>
      api('/api/v1/kra/approve', {
        method: 'POST',
        body: JSON.stringify({ cycleId: cycle.data!.cycle!.id }),
      }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const reject = useMutation({
    mutationFn: () =>
      api('/api/v1/kra/reject', {
        method: 'POST',
        body: JSON.stringify({ cycleId: cycle.data!.cycle!.id, note }),
      }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (cycle.isLoading) return <div className="text-xs text-ink-2">Loading…</div>;
  if (!cycle.data?.cycle) return <div className="text-xs text-ink-2">No cycle found.</div>;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-lg font-semibold">Review KRAs</h1>
      <div className="text-xs text-ink-2">State: {cycle.data.cycle.state}</div>

      <div className="space-y-3">
        {kras.data?.kras.map((k) => (
          <div key={k.id} className="bg-surface border border-hairline rounded-md p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-xs uppercase tracking-wider text-ink-2">{k.perspective}</div>
              <div className="text-xs text-ink-2">{k.weightPct}%</div>
            </div>
            <div className="text-sm mt-2">{k.description}</div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-ink-2">
              <div>
                <strong className="text-ink">Measurement:</strong> {k.measurement}
              </div>
              <div>
                <strong className="text-ink">Target:</strong> {k.target}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-hairline rounded-md p-4 space-y-3">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full border border-hairline rounded-sm p-2 text-sm"
          rows={2}
          placeholder="Rejection note (required if rejecting)"
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => approve.mutate()}
            className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => reject.mutate()}
            disabled={note.length < 3}
            className="bg-neg text-white rounded-sm px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
