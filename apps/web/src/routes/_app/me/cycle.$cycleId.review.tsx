import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { aiApi } from '../../../api/ai';
import { api } from '../../../api/client';
import { dashboardsApi } from '../../../api/dashboards';
import { pmsApi } from '../../../api/pms';
import { StepperForm, type StepperStep } from '../../../components/StepperForm';
import { AiPanel } from '../../../components/ai/AiPanel';
import { TrajectoryBar } from '../../../components/dashboard/TrajectoryBar';

export const Route = createFileRoute('/_app/me/cycle/$cycleId/review')({
  component: StaffSelfReview,
});

type KraRow = {
  id: string;
  description: string;
  perspective: string;
  weightPct: number;
  rubric1to5: string[];
};

// States where staff may edit their self-review
const SELF_REVIEW_STATES = new Set(['pms_self_review']);

// ── Part I — Results per KRA ──────────────────────────────────────────────────

function KraResultsStep({
  cycleId,
  kras,
  kraRatings,
  onChange,
}: {
  cycleId: string;
  kras: KraRow[];
  kraRatings: Record<string, { resultAchieved: string; selfRating: number }>;
  onChange: (kraId: string, field: 'resultAchieved' | 'selfRating', value: string | number) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-ink">Part I — Results per KRA</h2>
        <p className="text-xs text-ink-2 mt-1">
          For each Key Result Area, describe what you achieved and give yourself a self-rating
          (1–5).
        </p>
      </div>

      {kras.map((kra, i) => {
        const rating = kraRatings[kra.id] ?? { resultAchieved: '', selfRating: 3 };
        return (
          <div key={kra.id} className="bg-surface border border-hairline rounded-md p-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wider text-ink-2">
                KRA {i + 1} — {kra.perspective}
              </span>
              <span className="text-xs text-ink-2">{kra.weightPct}%</span>
            </div>
            <div className="text-sm font-medium text-ink">{kra.description}</div>

            {kra.rubric1to5.length > 0 && (
              <div className="grid grid-cols-5 gap-1.5">
                {kra.rubric1to5.map((anchor, idx) => (
                  <div
                    key={`${kra.id}-anchor-${idx}`}
                    className="rounded-sm border border-hairline bg-canvas p-2 text-xs text-ink-2"
                  >
                    <span className="block font-semibold text-ink mb-0.5">{idx + 1}</span>
                    {anchor}
                  </div>
                ))}
              </div>
            )}

            <div>
              <label htmlFor={`result-${kra.id}`} className="block text-xs text-ink-2 mb-1">
                Result achieved
              </label>
              <textarea
                id={`result-${kra.id}`}
                value={rating.resultAchieved}
                onChange={(e) => onChange(kra.id, 'resultAchieved', e.target.value)}
                rows={3}
                className="block w-full text-sm border border-hairline rounded-sm p-2 bg-white"
                placeholder="Describe what you delivered on this KRA…"
              />
            </div>

            <fieldset>
              <legend className="text-xs text-ink-2 mb-1.5">Self-rating</legend>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange(kra.id, 'selfRating', n)}
                    aria-pressed={rating.selfRating === n}
                    className={[
                      'w-9 h-9 text-sm rounded-sm border transition-colors',
                      rating.selfRating === n
                        ? 'bg-ink text-white border-ink'
                        : 'bg-surface border-hairline text-ink hover:bg-canvas',
                    ].join(' ')}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        );
      })}
    </div>
  );
}

// ── Part VI(b) — Appraisee comment ───────────────────────────────────────────

function AppraiseeCommentStep({
  comment,
  onChange,
}: {
  comment: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Part VI(b) — Your Comment</h2>
        <p className="text-xs text-ink-2 mt-1">
          Add any overall comments about your performance this year. This will be recorded and
          attributed to you when you submit.
        </p>
      </div>

      <div>
        <label htmlFor="appraisee-comment" className="block text-xs text-ink-2 mb-1">
          Comment
        </label>
        <textarea
          id="appraisee-comment"
          value={comment}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          className="block w-full text-sm border border-hairline rounded-sm p-3 bg-white"
          placeholder="Write your self-assessment comment here…"
        />
        <p className="text-xs text-ink-2 mt-1">
          By submitting, your identity and timestamp will be automatically captured server-side.
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function StaffSelfReview() {
  const { cycleId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Trajectory data from dashboards/me endpoint
  const trajectoryQuery = useQuery({
    queryKey: ['dashboards', 'me'],
    queryFn: () => dashboardsApi.me(),
    staleTime: 60_000,
  });
  const thisCycle = trajectoryQuery.data?.cycles.find((c) => c.id === cycleId);

  // KRA ratings local state: kraId → { resultAchieved, selfRating }
  const [kraRatings, setKraRatings] = useState<
    Record<string, { resultAchieved: string; selfRating: number }>
  >({});
  const [comment, setComment] = useState('');

  const pmsState = useQuery({
    queryKey: ['pms', 'state', cycleId],
    queryFn: () => pmsApi.getState(cycleId),
  });

  const krasQuery = useQuery({
    queryKey: ['kras', cycleId],
    queryFn: () => api<{ kras: KraRow[] }>(`/api/v1/kra/${cycleId}`),
    enabled: !!pmsState.data,
  });

  const saveKraRatings = useMutation({
    mutationFn: () => {
      const ratings = (krasQuery.data?.kras ?? []).map((kra) => {
        const r = kraRatings[kra.id] ?? { resultAchieved: '', selfRating: 3 };
        return {
          kraId: kra.id,
          resultAchieved: r.resultAchieved || '—',
          finalRating: r.selfRating,
        };
      });
      return pmsApi.saveKraRatings({ cycleId, ratings });
    },
  });

  const saveComment = useMutation({
    mutationFn: () => pmsApi.saveComment({ cycleId, role: 'appraisee', body: comment || '—' }),
  });

  const submitSelfReview = useMutation({
    mutationFn: () => pmsApi.submitSelfReview(cycleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pms', 'state', cycleId] });
      qc.invalidateQueries({ queryKey: ['cycle'] });
      navigate({ to: '/me' });
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

  // Read-only view when not in editable state
  if (!SELF_REVIEW_STATES.has(cycleState)) {
    return (
      <div className="p-8 max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold">Self-review — FY {state.cycle.fy}</h1>

        {/* Trajectory widget (June → now) */}
        {thisCycle && (thisCycle.trajectoryJune != null || thisCycle.trajectoryNow != null) && (
          <div className="bg-surface border border-hairline rounded-md p-4 space-y-2">
            <div className="text-xs uppercase tracking-wider text-ink-2">Rating trajectory</div>
            <div className="border-t border-hairline" />
            <TrajectoryBar
              june={thisCycle.trajectoryJune}
              current={thisCycle.trajectoryNow}
              max={5}
            />
          </div>
        )}
        {cycleState === 'pms_finalized' && (
          <AiPanel
            title="Performance Summary"
            queryKey={['ai', 'staff-summary', cycleId]}
            queryFn={() => aiApi.staffSummary(cycleId).then((r) => r.output)}
          >
            {(output) => (
              <div className="space-y-3 text-sm">
                {output.highlights.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                      Highlights
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5 text-ink">
                      {output.highlights.map((h, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {output.concerns.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">Concerns</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-ink">
                      {output.concerns.map((c, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {output.focus_areas.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                      Focus areas
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5 text-ink">
                      {output.focus_areas.map((f, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </AiPanel>
        )}
        <div className="bg-surface border border-hairline rounded-md p-4 text-sm text-ink-2">
          This cycle is currently in state{' '}
          <span className="font-medium text-ink">{cycleState}</span>. Self-review editing is closed.
        </div>
        <Link to="/me" className="text-sm text-ink underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const kras = krasQuery.data?.kras ?? [];

  const handleKraChange = (
    kraId: string,
    field: 'resultAchieved' | 'selfRating',
    value: string | number,
  ) => {
    setKraRatings((prev) => ({
      ...prev,
      [kraId]: { ...(prev[kraId] ?? { resultAchieved: '', selfRating: 3 }), [field]: value },
    }));
  };

  const steps: StepperStep[] = [
    {
      id: 'kra-results',
      title: 'Part I — Results',
      description: 'Your achievements per KRA',
      content: (
        <KraResultsStep
          cycleId={cycleId}
          kras={kras}
          kraRatings={kraRatings}
          onChange={handleKraChange}
        />
      ),
      canAdvance: () =>
        kras.every((k) => (kraRatings[k.id]?.resultAchieved ?? '').trim().length > 0),
    },
    {
      id: 'comment',
      title: 'Part VI(b) — Comment',
      description: 'Overall self-assessment',
      content: <AppraiseeCommentStep comment={comment} onChange={setComment} />,
    },
    {
      id: 'submit',
      title: 'Submit',
      description: 'Review and send',
      content: (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-ink">Ready to submit?</h2>
          <p className="text-sm text-ink-2">
            Once submitted, your self-review will be forwarded to your appraiser. You will not be
            able to edit it unless they return it to you.
          </p>
          {error && (
            <div className="rounded-sm border border-neg/30 bg-neg/5 p-3 text-sm text-neg">
              {error}
            </div>
          )}
          <ul className="text-sm text-ink-2 list-disc pl-4 space-y-1">
            <li>{kras.length} KRA result(s) filled</li>
            <li>Comment: {comment.trim().length > 0 ? 'provided' : 'empty (will be skipped)'}</li>
          </ul>
        </div>
      ),
    },
  ];

  const handleComplete = async () => {
    setError(null);
    // Save KRA ratings
    if (kras.length > 0) await saveKraRatings.mutateAsync();
    // Save comment if provided
    if (comment.trim().length > 0) await saveComment.mutateAsync();
    // Submit transition
    await submitSelfReview.mutateAsync();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-8 py-5 border-b border-hairline bg-surface space-y-3">
        <div>
          <h1 className="text-base font-semibold">Self-review — FY {state.cycle.fy}</h1>
          <p className="text-xs text-ink-2 mt-0.5">
            Complete all steps and submit for appraiser review.
          </p>
        </div>
        {/* Trajectory widget */}
        {thisCycle && (thisCycle.trajectoryJune != null || thisCycle.trajectoryNow != null) && (
          <div className="max-w-xs">
            <div className="text-xs text-ink-2 mb-1">Rating trajectory (June → now)</div>
            <TrajectoryBar
              june={thisCycle.trajectoryJune}
              current={thisCycle.trajectoryNow}
              max={5}
            />
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <StepperForm steps={steps} onComplete={handleComplete} submitLabel="Submit self-review" />
      </div>
    </div>
  );
}
