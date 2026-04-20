import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../../../api/client';
import { pmsApi } from '../../../api/pms';

export const Route = createFileRoute('/_app/hr/cycle/$cycleId/finalize')({
  component: HraFinalize,
});

type KraRow = {
  id: string;
  description: string;
  perspective: string;
  weightPct: number;
};

const HRA_FINALIZE_STATES = new Set(['pms_awaiting_hra', 'pms_finalized']);

function HraFinalize() {
  const { cycleId } = Route.useParams();
  const qc = useQueryClient();
  const [reopenReason, setReopenReason] = useState('');
  const [showReopen, setShowReopen] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'loading' | 'ready' | 'not_ready'>('idle');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const pmsState = useQuery({
    queryKey: ['pms', 'state', cycleId],
    queryFn: () => pmsApi.getState(cycleId),
  });

  const scoreQuery = useQuery({
    queryKey: ['pms', 'score', cycleId],
    queryFn: () => pmsApi.getScore(cycleId),
    enabled: !!pmsState.data,
  });

  const krasQuery = useQuery({
    queryKey: ['kras', cycleId],
    queryFn: () => api<{ kras: KraRow[] }>(`/api/v1/kra/${cycleId}`),
    enabled: !!pmsState.data,
  });

  const dimsQuery = useQuery({
    queryKey: ['pms', 'behavioural-dimensions'],
    queryFn: () => pmsApi.getBehaviouralDimensions(),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => pmsApi.finalize(cycleId),
    onSuccess: () => {
      setSuccess(true);
      setError(null);
      qc.invalidateQueries({ queryKey: ['pms', 'state', cycleId] });
      qc.invalidateQueries({ queryKey: ['pms', 'score', cycleId] });
    },
    onError: (e) => setError(String(e)),
  });

  const reopenMutation = useMutation({
    mutationFn: () => pmsApi.reopen(cycleId, reopenReason),
    onSuccess: () => {
      setShowReopen(false);
      setReopenReason('');
      setSuccess(false);
      qc.invalidateQueries({ queryKey: ['pms', 'state', cycleId] });
    },
    onError: (e) => setError(String(e)),
  });

  const fetchPdf = async () => {
    setPdfStatus('loading');
    try {
      const { url } = await pmsApi.getPdfUrl(cycleId);
      setPdfUrl(url);
      setPdfStatus('ready');
    } catch {
      setPdfStatus('not_ready');
    }
  };

  if (pmsState.isLoading) {
    return <div className="p-8 text-sm text-ink-2">Loading…</div>;
  }

  const state = pmsState.data;
  if (!state) {
    return <div className="p-8 text-sm text-neg">Failed to load PMS state.</div>;
  }

  const cycleState = state.cycle.state;

  if (!HRA_FINALIZE_STATES.has(cycleState)) {
    return (
      <div className="p-8 max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold">HRA Finalize — FY {state.cycle.fy}</h1>
        <div className="bg-surface border border-hairline rounded-md p-4 text-sm text-ink-2">
          This cycle is in state <span className="font-medium text-ink">{cycleState}</span>. HRA
          finalization is not available.
        </div>
        <Link to="/hr" className="text-sm text-ink underline">
          Back to HR
        </Link>
      </div>
    );
  }

  const kras = krasQuery.data?.kras ?? [];
  const byKraId = new Map(state.kraRatings.map((r) => [r.kraId, r]));
  const dimTitles = new Map((dimsQuery.data?.items ?? []).map((d) => [d.code, d.title]));
  const score = scoreQuery.data?.breakdown;
  const isFinalized = cycleState === 'pms_finalized';

  const appraiseeComment = state.comments.find((c) => c.role === 'appraisee');
  const appraiserComment = state.comments.find((c) => c.role === 'appraiser');
  const nextLevelComment = state.comments.find((c) => c.role === 'next_level');

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">HRA Finalize — FY {state.cycle.fy}</h1>
          <div className="text-xs text-ink-2 mt-1">
            State: <span className="font-medium text-ink">{cycleState}</span>
          </div>
        </div>
        <Link to="/hr" className="text-sm text-ink underline">
          Back to HR
        </Link>
      </div>

      {/* Score card */}
      {score && (
        <div className="bg-surface border border-hairline rounded-md p-6">
          <div className="text-xs uppercase tracking-wider text-ink-2 mb-4">Computed Score</div>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-semibold text-ink">{score.total.toFixed(2)}</div>
              <div className="text-xs text-ink-2 mt-1">Total (/ 5)</div>
            </div>
            <div className="text-center border-l border-hairline">
              <div className="text-xl font-medium text-ink">{score.kra.toFixed(2)}</div>
              <div className="text-xs text-ink-2 mt-1">KRA (70%)</div>
            </div>
            <div className="text-center border-l border-hairline">
              <div className="text-xl font-medium text-ink">{score.behavioural.toFixed(2)}</div>
              <div className="text-xs text-ink-2 mt-1">Behavioural (25%)</div>
            </div>
            <div className="text-center border-l border-hairline">
              <div className="text-xl font-medium text-ink">{score.contribution.toFixed(2)}</div>
              <div className="text-xs text-ink-2 mt-1">Contribution (5%)</div>
            </div>
          </div>
        </div>
      )}

      {/* Part I — KRAs */}
      <section>
        <h2 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
          Part I — KRA Results &amp; Final Ratings
        </h2>
        <div className="space-y-3">
          {kras.map((kra, i) => {
            const r = byKraId.get(kra.id);
            return (
              <div
                key={kra.id}
                className="bg-surface border border-hairline rounded-md p-4 space-y-2"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs uppercase tracking-wider text-ink-2">
                    KRA {i + 1} — {kra.perspective}
                  </span>
                  <span className="text-xs text-ink-2">{kra.weightPct}%</span>
                </div>
                <div className="text-sm">{kra.description}</div>
                {r && (
                  <div className="border-t border-hairline pt-2 flex items-baseline justify-between">
                    <div className="text-sm text-ink-2">{r.resultAchieved ?? '—'}</div>
                    <div className="text-sm font-medium text-ink shrink-0 ml-4">
                      {r.finalRating ?? '—'}/5
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Part II — Behavioural */}
      {state.behavioural.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
            Part II — Behavioural ({state.behavioural.length} dimensions)
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {state.behavioural.map((b) => (
              <div
                key={b.dimensionCode}
                className="flex items-baseline justify-between rounded-sm border border-hairline bg-surface p-3"
              >
                <div className="text-sm text-ink">
                  {dimTitles.get(b.dimensionCode) ?? b.dimensionCode}
                </div>
                <div className="text-sm font-medium text-ink shrink-0 ml-2">{b.rating}/5</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Part III — Contributions */}
      {state.contributions.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
            Part III — Contributions
          </h2>
          <div className="space-y-2">
            {state.contributions.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between rounded-sm border border-hairline bg-surface p-3"
              >
                <div>
                  <div className="text-xs text-ink-2">{c.whenDate}</div>
                  <div className="text-sm">{c.achievement}</div>
                </div>
                <div className="text-sm font-medium shrink-0 ml-4">+{c.weightPct}%</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Part V */}
      {(state.career || state.growth) && (
        <section>
          <h2 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
            Part V — Career &amp; Growth
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {state.career && (
              <div className="bg-surface border border-hairline rounded-md p-4">
                <div className="text-xs text-ink-2 mb-1">Potential window</div>
                <div className="text-sm">{state.career.potentialWindow}</div>
                {state.career.notes && (
                  <div className="text-xs text-ink-2 mt-2">{state.career.notes}</div>
                )}
              </div>
            )}
            {state.growth && (
              <div className="bg-surface border border-hairline rounded-md p-4">
                <div className="text-xs text-ink-2 mb-1">Training needs</div>
                <div className="text-sm">{state.growth.goals ?? '—'}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Part VI — Comments */}
      <section>
        <h2 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
          Part VI — Comments
        </h2>
        <div className="space-y-3">
          {appraiseeComment && (
            <div className="bg-surface border border-hairline rounded-md p-4">
              <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                Appraisee (VI(b))
              </div>
              <div className="text-sm">{appraiseeComment.body}</div>
            </div>
          )}
          {appraiserComment && (
            <div className="bg-surface border border-hairline rounded-md p-4">
              <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                Appraiser (VI(a))
              </div>
              <div className="text-sm">{appraiserComment.body}</div>
            </div>
          )}
          {nextLevelComment && (
            <div className="bg-surface border border-hairline rounded-md p-4">
              <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                Next-level (VI(c))
              </div>
              <div className="text-sm">{nextLevelComment.body}</div>
            </div>
          )}
          {!appraiseeComment && !appraiserComment && !nextLevelComment && (
            <div className="text-sm text-ink-2">No comments recorded.</div>
          )}
        </div>
      </section>

      {/* Actions */}
      {error && (
        <div className="rounded-sm border border-neg/30 bg-neg/5 p-3 text-sm text-neg">{error}</div>
      )}

      {success && (
        <div className="rounded-sm border border-pos/30 bg-pos/5 p-3 text-sm text-pos">
          PMS finalized successfully.
        </div>
      )}

      <div className="border-t border-hairline pt-6 space-y-4">
        {/* Primary: Finalize */}
        {!isFinalized && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => finalizeMutation.mutate()}
              disabled={finalizeMutation.isPending}
              className="rounded-sm bg-ink text-white px-4 py-2 text-sm hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {finalizeMutation.isPending ? 'Finalizing…' : 'Finalize PMS'}
            </button>
            <p className="text-xs text-ink-2">
              This will lock the assessment and trigger a PDF generation job.
            </p>
          </div>
        )}

        {/* PDF download */}
        {isFinalized && (
          <div className="flex items-center gap-4">
            {pdfStatus === 'idle' && (
              <button
                type="button"
                onClick={fetchPdf}
                className="rounded-sm border border-hairline px-4 py-2 text-sm hover:bg-canvas"
              >
                Get PDF download link
              </button>
            )}
            {pdfStatus === 'loading' && <span className="text-sm text-ink-2">Checking PDF…</span>}
            {pdfStatus === 'ready' && pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm bg-ink text-white px-4 py-2 text-sm hover:bg-ink/90"
              >
                Download PDF
              </a>
            )}
            {pdfStatus === 'not_ready' && (
              <div className="text-sm text-ink-2">
                PDF is not ready yet — the generation job may take a few minutes. Check back shortly
                or wait for a notification in your inbox.
                <button type="button" onClick={fetchPdf} className="ml-2 underline text-ink">
                  Retry
                </button>
              </div>
            )}
          </div>
        )}

        {/* Re-open PMS — secondary, destructive */}
        {isFinalized && (
          <div className="pt-2 border-t border-hairline">
            {!showReopen ? (
              <button
                type="button"
                onClick={() => setShowReopen(true)}
                className="text-sm text-ink-2 hover:text-ink hover:underline"
              >
                Re-open PMS (admin action)
              </button>
            ) : (
              <div className="space-y-3 max-w-lg">
                <div className="text-sm font-medium text-ink">Re-open PMS</div>
                <p className="text-xs text-ink-2">
                  This will revert the cycle to awaiting HRA state. Provide a reason.
                </p>
                <textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  rows={3}
                  className="block w-full text-sm border border-hairline rounded-sm p-2 bg-white"
                  placeholder="Reason for re-opening (required, min 3 characters)…"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => reopenMutation.mutate()}
                    disabled={reopenReason.trim().length < 3 || reopenMutation.isPending}
                    className="rounded-sm px-3 py-1.5 text-sm border border-neg text-neg hover:bg-neg/5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {reopenMutation.isPending ? 'Re-opening…' : 'Confirm re-open'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReopen(false);
                      setReopenReason('');
                    }}
                    className="text-sm text-ink-2 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
