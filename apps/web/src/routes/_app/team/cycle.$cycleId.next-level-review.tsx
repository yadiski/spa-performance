import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../../../api/client';
import { pmsApi } from '../../../api/pms';
import { StepperForm, type StepperStep } from '../../../components/StepperForm';

export const Route = createFileRoute('/_app/team/cycle/$cycleId/next-level-review')({
  component: NextLevelReview,
});

type KraRow = {
  id: string;
  description: string;
  perspective: string;
  weightPct: number;
};

const NEXT_LEVEL_STATES = new Set(['pms_awaiting_next_lvl']);

// ── Read-only summary ─────────────────────────────────────────────────────────

function ReadOnlySummary({ cycleId }: { cycleId: string }) {
  const pmsState = useQuery({
    queryKey: ['pms', 'state', cycleId],
    queryFn: () => pmsApi.getState(cycleId),
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

  if (pmsState.isLoading) {
    return <div className="text-sm text-ink-2">Loading summary…</div>;
  }

  const state = pmsState.data;
  if (!state) return null;

  const kras = krasQuery.data?.kras ?? [];
  const byKraId = new Map(state.kraRatings.map((r) => [r.kraId, r]));
  const dimTitles = new Map((dimsQuery.data?.items ?? []).map((d) => [d.code, d.title]));

  const appraiserComment = state.comments.find((c) => c.role === 'appraiser');
  const appraiseeComment = state.comments.find((c) => c.role === 'appraisee');

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-ink">Review — FY {state.cycle.fy}</h2>
        <p className="text-xs text-ink-2 mt-1">
          Read-only summary of the full assessment before you sign off.
        </p>
      </div>

      {/* Part I — KRAs */}
      <section>
        <h3 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
          Part I — KRA Results &amp; Final Ratings
        </h3>
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
                  <div className="border-t border-hairline pt-2 space-y-1">
                    <div className="text-xs text-ink-2">
                      Result: <span className="text-ink">{r.resultAchieved ?? '—'}</span>
                    </div>
                    <div className="text-xs text-ink-2">
                      Final rating:{' '}
                      <span className="font-medium text-ink">{r.finalRating ?? '—'}/5</span>
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
          <h3 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
            Part II — Behavioural Dimensions ({state.behavioural.length} rated)
          </h3>
          <div className="space-y-2">
            {state.behavioural.map((b) => (
              <div
                key={b.dimensionCode}
                className="flex items-baseline justify-between rounded-sm border border-hairline bg-surface p-3"
              >
                <div className="text-sm text-ink">
                  {dimTitles.get(b.dimensionCode) ?? b.dimensionCode}
                </div>
                <div className="text-sm font-medium text-ink shrink-0 ml-4">{b.rating}/5</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Part III — Contributions */}
      {state.contributions.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
            Part III — Contributions
          </h3>
          <div className="space-y-2">
            {state.contributions.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between rounded-sm border border-hairline bg-surface p-3"
              >
                <div className="space-y-0.5">
                  <div className="text-xs text-ink-2">{c.whenDate}</div>
                  <div className="text-sm text-ink">{c.achievement}</div>
                </div>
                <div className="text-sm font-medium text-ink shrink-0 ml-4">+{c.weightPct}%</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Part V — Career + Growth */}
      {(state.career || state.growth) && (
        <section>
          <h3 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
            Part V — Career &amp; Growth
          </h3>
          {state.career && (
            <div className="bg-surface border border-hairline rounded-md p-4 space-y-1 mb-3">
              <div className="text-xs text-ink-2">Potential window</div>
              <div className="text-sm text-ink">{state.career.potentialWindow}</div>
              {state.career.notes && (
                <div className="text-sm text-ink-2 mt-1">{state.career.notes}</div>
              )}
            </div>
          )}
          {state.growth && (
            <div className="bg-surface border border-hairline rounded-md p-4 space-y-1">
              <div className="text-xs text-ink-2">Training needs</div>
              <div className="text-sm text-ink">{state.growth.goals ?? '—'}</div>
            </div>
          )}
        </section>
      )}

      {/* Comments */}
      {(appraiseeComment || appraiserComment) && (
        <section>
          <h3 className="text-sm font-medium text-ink mb-3 border-b border-hairline pb-1">
            Part VI — Comments
          </h3>
          <div className="space-y-3">
            {appraiseeComment && (
              <div className="bg-surface border border-hairline rounded-md p-4">
                <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                  Appraisee (Part VI(b))
                </div>
                <div className="text-sm text-ink">{appraiseeComment.body}</div>
              </div>
            )}
            {appraiserComment && (
              <div className="bg-surface border border-hairline rounded-md p-4">
                <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                  Appraiser (Part VI(a))
                </div>
                <div className="text-sm text-ink">{appraiserComment.body}</div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Part VI(c) — Next-level comment ──────────────────────────────────────────

function NextLevelSignStep({
  comment,
  onChange,
}: {
  comment: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">
          Part VI(c) — Next-Level Comment &amp; Sign
        </h2>
        <p className="text-xs text-ink-2 mt-1">
          Add your endorsement or concerns. Submitting captures your identity and timestamp.
        </p>
      </div>
      <div>
        <label htmlFor="nl-comment" className="block text-xs text-ink-2 mb-1">
          Comment
        </label>
        <textarea
          id="nl-comment"
          value={comment}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          className="block w-full text-sm border border-hairline rounded-sm p-3 bg-white"
          placeholder="Overall endorsement or observations…"
        />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function NextLevelReview() {
  const { cycleId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [returnNote, setReturnNote] = useState('');
  const [showReturn, setShowReturn] = useState(false);

  const pmsState = useQuery({
    queryKey: ['pms', 'state', cycleId],
    queryFn: () => pmsApi.getState(cycleId),
  });

  const returnMutation = useMutation({
    mutationFn: () => pmsApi.returnToAppraiser(cycleId, returnNote || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pms', 'state', cycleId] });
      navigate({ to: '/team' });
    },
    onError: (e) => setError(String(e)),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (comment.trim()) {
        await pmsApi.saveComment({ cycleId, role: 'next_level', body: comment });
      }
      await pmsApi.submitNextLevel(cycleId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pms', 'state', cycleId] });
      qc.invalidateQueries({ queryKey: ['cycle'] });
      navigate({ to: '/team' });
    },
    onError: (e) => setError(String(e)),
  });

  if (pmsState.isLoading) {
    return <div className="p-8 text-sm text-ink-2">Loading…</div>;
  }

  const state = pmsState.data;
  if (!state) {
    return <div className="p-8 text-sm text-neg">Failed to load PMS state.</div>;
  }

  const cycleState = state.cycle.state;

  if (!NEXT_LEVEL_STATES.has(cycleState)) {
    return (
      <div className="p-8 max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold">Next-level Review — FY {state.cycle.fy}</h1>
        <div className="bg-surface border border-hairline rounded-md p-4 text-sm text-ink-2">
          This cycle is in state <span className="font-medium text-ink">{cycleState}</span>.
          Next-level review is not currently available.
        </div>
        <Link to="/team" className="text-sm text-ink underline">
          Back to team
        </Link>
      </div>
    );
  }

  const steps: StepperStep[] = [
    {
      id: 'review',
      title: 'Review',
      description: 'Read-only summary',
      content: <ReadOnlySummary cycleId={cycleId} />,
    },
    {
      id: 'sign',
      title: 'Part VI(c) — Sign',
      description: 'Next-level endorsement',
      content: <NextLevelSignStep comment={comment} onChange={setComment} />,
    },
    {
      id: 'submit',
      title: 'Submit / Return',
      description: 'Forward to HRA',
      content: (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-ink">Ready to forward to HRA?</h2>
          <p className="text-sm text-ink-2">
            Once submitted, the appraisal will be forwarded to the HR Administrator for final
            review. Use the return button if revisions are required.
          </p>
          {error && (
            <div className="rounded-sm border border-neg/30 bg-neg/5 p-3 text-sm text-neg">
              {error}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-8 py-5 border-b border-hairline bg-surface flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Next-level Review — FY {state.cycle.fy}</h1>
          <p className="text-xs text-ink-2 mt-0.5">
            Review the full appraisal and sign off or return to appraiser.
          </p>
        </div>

        {/* Return to appraiser — secondary action */}
        <div className="flex items-center gap-3">
          {showReturn ? (
            <div className="flex items-center gap-2">
              <input
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                className="text-sm border border-hairline rounded-sm px-2 py-1 bg-white w-56"
                placeholder="Note for appraiser (optional)"
              />
              <button
                type="button"
                onClick={() => returnMutation.mutate()}
                disabled={returnMutation.isPending}
                className="rounded-sm px-3 py-1.5 text-sm border border-neg text-neg hover:bg-neg/5 disabled:opacity-40"
              >
                {returnMutation.isPending ? 'Returning…' : 'Confirm return'}
              </button>
              <button
                type="button"
                onClick={() => setShowReturn(false)}
                className="text-sm text-ink-2 hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowReturn(true)}
              className="rounded-sm px-3 py-1.5 text-sm border border-hairline text-ink-2 hover:bg-canvas"
            >
              Return to appraiser
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <StepperForm
          steps={steps}
          onComplete={() => submitMutation.mutateAsync()}
          submitLabel="Submit to HRA"
        />
      </div>
    </div>
  );
}
