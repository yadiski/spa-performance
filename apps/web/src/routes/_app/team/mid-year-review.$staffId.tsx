import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../../../api/client';

export const Route = createFileRoute('/_app/team/mid-year-review/$staffId')({
  component: MidYearReview,
});

type KraRow = {
  id: string;
  description: string;
  perspective: string;
  weightPct: number;
};

type ProgressUpdate = {
  id: string;
  kraId: string;
  resultAchieved: string;
  rating1to5: number;
  byRole: string;
};

function MidYearReview() {
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

  const progress = useQuery({
    queryKey: ['mid-year-progress', cycle.data?.cycle?.id],
    queryFn: () =>
      api<{ updates: ProgressUpdate[]; summary: string | null }>(
        `/api/v1/mid-year/${cycle.data!.cycle!.id}`,
      ),
    enabled: !!cycle.data?.cycle?.id,
  });

  const ack = useMutation({
    mutationFn: () =>
      api('/api/v1/mid-year/ack', {
        method: 'POST',
        body: JSON.stringify({ cycleId: cycle.data!.cycle!.id, note: note || undefined }),
      }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (cycle.isLoading) return <div className="text-xs text-ink-2">Loading...</div>;
  if (!cycle.data?.cycle) return <div className="text-xs text-ink-2">No cycle found.</div>;
  if (cycle.data.cycle.state !== 'mid_year_submitted') {
    return (
      <div className="text-xs text-ink-2">
        Mid-year not pending review. State: {cycle.data.cycle.state}
      </div>
    );
  }

  const byKra = new Map(progress.data?.updates.map((u) => [u.kraId, u]) ?? []);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-lg font-semibold">Mid-year review</h1>

      <div className="space-y-3">
        {kras.data?.kras.map((k) => {
          const u = byKra.get(k.id);
          return (
            <div key={k.id} className="bg-surface border border-hairline rounded-md p-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <div className="text-xs uppercase tracking-wider text-ink-2">{k.perspective}</div>
                <div className="text-xs text-ink-2">{k.weightPct}%</div>
              </div>
              <div className="text-sm">{k.description}</div>
              <div className="mt-2 border-t border-hairline pt-2">
                <div className="text-xs uppercase tracking-wider text-ink-2">Staff reported</div>
                <div className="text-sm mt-1">
                  {u ? u.resultAchieved : <span className="text-ink-2">No update.</span>}
                </div>
                {u && (
                  <div className="text-xs text-ink-2 mt-1">
                    Informal rating: <strong className="text-ink">{u.rating1to5}/5</strong>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {progress.data?.summary && (
        <div className="bg-surface border border-hairline rounded-md p-4">
          <div className="text-xs uppercase tracking-wider text-ink-2 mb-2">Overall summary</div>
          <div className="text-sm">{progress.data.summary}</div>
        </div>
      )}

      <div className="bg-surface border border-hairline rounded-md p-4 space-y-3">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full border border-hairline rounded-sm p-2 text-sm"
          rows={2}
          placeholder="Optional acknowledgement note"
        />
        <button
          type="button"
          onClick={() => ack.mutate()}
          className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm"
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
}
