import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { aiApi } from '../../../api/ai';
import { api } from '../../../api/client';
import { type BehaviouralDimensionItem, pmsApi } from '../../../api/pms';
import { BehaviouralAnchor } from '../../../components/BehaviouralAnchor';
import { StepperForm, type StepperStep } from '../../../components/StepperForm';
import { AiPanel } from '../../../components/ai/AiPanel';

export const Route = createFileRoute('/_app/team/cycle/$cycleId/review')({
  component: AppraiserReview,
});

type KraRow = {
  id: string;
  description: string;
  perspective: string;
  weightPct: number;
  rubric1to5: string[];
};

const APPRAISER_STATES = new Set(['pms_awaiting_appraiser']);

// ── Part I — Final KRA ratings ────────────────────────────────────────────────

function KraFinalRatingsStep({
  kras,
  existingResults,
  finalRatings,
  onChange,
}: {
  kras: KraRow[];
  existingResults: Record<string, string | null>;
  finalRatings: Record<string, { rating: number }>;
  onChange: (kraId: string, rating: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-ink">Part I — Final KRA Ratings</h2>
        <p className="text-xs text-ink-2 mt-1">
          Review the appraisee's self-reported results and assign a final rating (1–5) for each KRA.
        </p>
      </div>

      {kras.map((kra, i) => {
        const existing = existingResults[kra.id] ?? null;
        const r = finalRatings[kra.id]?.rating ?? 3;

        return (
          <div key={kra.id} className="bg-surface border border-hairline rounded-md p-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wider text-ink-2">
                KRA {i + 1} — {kra.perspective}
              </span>
              <span className="text-xs text-ink-2">{kra.weightPct}%</span>
            </div>
            <div className="text-sm font-medium text-ink">{kra.description}</div>

            {existing && (
              <div className="rounded-sm border border-hairline bg-canvas p-3">
                <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                  Staff reported
                </div>
                <div className="text-sm text-ink">{existing}</div>
              </div>
            )}

            {kra.rubric1to5.length > 0 && (
              <div className="grid grid-cols-5 gap-1.5">
                {kra.rubric1to5.map((anchor, idx) => (
                  <div
                    key={`${kra.id}-a-${idx}`}
                    className={[
                      'rounded-sm border p-2 text-xs transition-colors',
                      r === idx + 1
                        ? 'border-ink bg-canvas font-medium text-ink'
                        : 'border-hairline bg-surface text-ink-2',
                    ].join(' ')}
                  >
                    <span className="block font-semibold text-sm mb-0.5">{idx + 1}</span>
                    {anchor}
                  </div>
                ))}
              </div>
            )}

            <fieldset>
              <legend className="text-xs text-ink-2 mb-1.5">Final rating</legend>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange(kra.id, n)}
                    aria-pressed={r === n}
                    className={[
                      'w-9 h-9 text-sm rounded-sm border transition-colors',
                      r === n
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

// ── Part II — 22 Behavioural dimensions ──────────────────────────────────────

function BehaviouralStep({
  dimensions,
  ratings,
  onChange,
}: {
  dimensions: BehaviouralDimensionItem[];
  ratings: Record<string, { rating: 1 | 2 | 3 | 4 | 5 | null; anchorText: string | null }>;
  onChange: (code: string, rating: 1 | 2 | 3 | 4 | 5, anchorText: string) => void;
}) {
  const ratedCount = Object.values(ratings).filter((r) => r.rating !== null).length;

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Part II — Behavioural Dimensions</h2>
          <p className="text-xs text-ink-2 mt-1">
            Rate all 22 behavioural competencies by selecting the anchor that best describes the
            appraisee.
          </p>
        </div>
        <div className="text-sm font-medium text-ink shrink-0 ml-4">
          {ratedCount} / {dimensions.length} rated
        </div>
      </div>

      {dimensions.map((dim) => (
        <div key={dim.code} className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-ink-2 border-b border-hairline pb-1">
            {dim.title}
          </div>
          <BehaviouralAnchor
            dimension={dim}
            value={ratings[dim.code] ?? { rating: null, anchorText: null }}
            onChange={({ rating, anchorText }) => onChange(dim.code, rating, anchorText)}
          />
        </div>
      ))}
    </div>
  );
}

// ── Part III — Contributions ──────────────────────────────────────────────────

type ContributionDraft = {
  whenDate: string;
  achievement: string;
  weightPct: number;
};

function ContributionsStep({
  contributions,
  onChange,
}: {
  contributions: ContributionDraft[];
  onChange: (updated: ContributionDraft[]) => void;
}) {
  const totalPct = contributions.reduce((s, c) => s + (c.weightPct || 0), 0);
  const overLimit = totalPct > 5;

  const addRow = () =>
    onChange([...contributions, { whenDate: '', achievement: '', weightPct: 0 }]);
  const removeRow = (i: number) => onChange(contributions.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof ContributionDraft, value: string | number) =>
    onChange(contributions.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Part III — Staff Contributions</h2>
        <p className="text-xs text-ink-2 mt-1">
          Record notable contributions beyond core KRAs. Total bonus weight must not exceed 5%.
        </p>
      </div>

      <div className="space-y-3">
        {contributions.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: list managed by index
          <div key={i} className="bg-surface border border-hairline rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-ink-2">
                Contribution {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-xs text-neg hover:underline"
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`contrib-date-${i}`} className="block text-xs text-ink-2 mb-1">
                  When (e.g. "June 2026")
                </label>
                <input
                  id={`contrib-date-${i}`}
                  value={c.whenDate}
                  onChange={(e) => updateRow(i, 'whenDate', e.target.value)}
                  className="w-full text-sm border border-hairline rounded-sm p-2 bg-white"
                  placeholder="Month YYYY"
                />
              </div>
              <div>
                <label htmlFor={`contrib-weight-${i}`} className="block text-xs text-ink-2 mb-1">
                  Weight % (0–5)
                </label>
                <input
                  id={`contrib-weight-${i}`}
                  type="number"
                  min={0}
                  max={5}
                  value={c.weightPct}
                  onChange={(e) => updateRow(i, 'weightPct', Number(e.target.value))}
                  className="w-full text-sm border border-hairline rounded-sm p-2 bg-white"
                />
              </div>
            </div>
            <div>
              <label htmlFor={`contrib-achiev-${i}`} className="block text-xs text-ink-2 mb-1">
                Achievement
              </label>
              <textarea
                id={`contrib-achiev-${i}`}
                value={c.achievement}
                onChange={(e) => updateRow(i, 'achievement', e.target.value)}
                rows={2}
                className="block w-full text-sm border border-hairline rounded-sm p-2 bg-white"
                placeholder="Describe the contribution…"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addRow}
          className="text-sm border border-hairline rounded-sm px-3 py-1.5 hover:bg-canvas"
        >
          + Add contribution
        </button>
        <div className={`text-sm ${overLimit ? 'text-neg font-medium' : 'text-ink-2'}`}>
          Total: {totalPct}% / 5%{overLimit && ' — exceeds limit'}
        </div>
      </div>
    </div>
  );
}

// ── Part V — Career + Growth ──────────────────────────────────────────────────

const POTENTIAL_WINDOWS = [
  { value: 'now', label: 'Ready now' },
  { value: '1-2_years', label: '1–2 years' },
  { value: 'after_2_years', label: 'After 2 years' },
  { value: 'not_ready', label: 'Not ready' },
  { value: 'max_reached', label: 'Max reached' },
] as const;

function CareerGrowthStep({
  career,
  growth,
  onCareerChange,
  onGrowthChange,
}: {
  career: { potentialWindow: string; readyIn: string; comments: string };
  growth: { trainingNeeds: string; comments: string };
  onCareerChange: (field: 'potentialWindow' | 'readyIn' | 'comments', value: string) => void;
  onGrowthChange: (field: 'trainingNeeds' | 'comments', value: string) => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-ink">Part V — Career &amp; Growth</h2>
        <p className="text-xs text-ink-2 mt-1">
          Assess the appraisee's potential trajectory and development needs.
        </p>
      </div>

      {/* Part V(a) — Career development */}
      <div className="bg-surface border border-hairline rounded-md p-5 space-y-4">
        <div className="text-sm font-medium text-ink">V(a) Career Development</div>

        <div>
          <div className="text-xs text-ink-2 mb-2">Potential window</div>
          <div className="flex flex-wrap gap-2">
            {POTENTIAL_WINDOWS.map((pw) => (
              <button
                key={pw.value}
                type="button"
                onClick={() => onCareerChange('potentialWindow', pw.value)}
                aria-pressed={career.potentialWindow === pw.value}
                className={[
                  'rounded-sm border px-3 py-1.5 text-sm transition-colors',
                  career.potentialWindow === pw.value
                    ? 'bg-ink text-white border-ink'
                    : 'border-hairline bg-surface text-ink hover:bg-canvas',
                ].join(' ')}
              >
                {pw.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="career-readyin" className="block text-xs text-ink-2 mb-1">
            Ready in (optional detail)
          </label>
          <input
            id="career-readyin"
            value={career.readyIn}
            onChange={(e) => onCareerChange('readyIn', e.target.value)}
            className="w-full text-sm border border-hairline rounded-sm p-2 bg-white"
            placeholder="e.g. 18 months with exposure to project management…"
          />
        </div>

        <div>
          <label htmlFor="career-comments" className="block text-xs text-ink-2 mb-1">
            Comments
          </label>
          <textarea
            id="career-comments"
            value={career.comments}
            onChange={(e) => onCareerChange('comments', e.target.value)}
            rows={3}
            className="block w-full text-sm border border-hairline rounded-sm p-2 bg-white"
          />
        </div>
      </div>

      {/* Part V(b) — Personal growth */}
      <div className="bg-surface border border-hairline rounded-md p-5 space-y-4">
        <div className="text-sm font-medium text-ink">V(b) Personal Growth Plan</div>

        <div>
          <label htmlFor="growth-training" className="block text-xs text-ink-2 mb-1">
            Training needs
          </label>
          <textarea
            id="growth-training"
            value={growth.trainingNeeds}
            onChange={(e) => onGrowthChange('trainingNeeds', e.target.value)}
            rows={3}
            className="block w-full text-sm border border-hairline rounded-sm p-2 bg-white"
            placeholder="Identify skills gaps and recommended courses…"
          />
        </div>

        <div>
          <label htmlFor="growth-comments" className="block text-xs text-ink-2 mb-1">
            Comments
          </label>
          <textarea
            id="growth-comments"
            value={growth.comments}
            onChange={(e) => onGrowthChange('comments', e.target.value)}
            rows={3}
            className="block w-full text-sm border border-hairline rounded-sm p-2 bg-white"
          />
        </div>
      </div>
    </div>
  );
}

// ── Part VI(a) — Appraiser comment / sign ────────────────────────────────────

function AppraiserSignStep({
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
          Part VI(a) — Appraiser Comment &amp; Sign
        </h2>
        <p className="text-xs text-ink-2 mt-1">
          Provide your overall assessment comment. Submitting will capture your identity and
          timestamp automatically.
        </p>
      </div>

      <div>
        <label htmlFor="appraiser-comment" className="block text-xs text-ink-2 mb-1">
          Comment
        </label>
        <textarea
          id="appraiser-comment"
          value={comment}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          className="block w-full text-sm border border-hairline rounded-sm p-3 bg-white"
          placeholder="Overall performance assessment…"
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function AppraiserReview() {
  const { cycleId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [returnNote, setReturnNote] = useState('');
  const [showReturn, setShowReturn] = useState(false);

  const [finalRatings, setFinalRatings] = useState<Record<string, { rating: number }>>({});
  const [behaviouralRatings, setBehaviouralRatings] = useState<
    Record<string, { rating: 1 | 2 | 3 | 4 | 5 | null; anchorText: string | null }>
  >({});
  const [contributions, setContributions] = useState<ContributionDraft[]>([]);
  const [career, setCareer] = useState({
    potentialWindow: 'not_ready',
    readyIn: '',
    comments: '',
  });
  const [growth, setGrowth] = useState({ trainingNeeds: '', comments: '' });
  const [appraiserComment, setAppraiserComment] = useState('');

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

  const returnMutation = useMutation({
    mutationFn: () => pmsApi.returnToAppraisee(cycleId, returnNote || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pms', 'state', cycleId] });
      navigate({ to: '/team' });
    },
    onError: (e) => setError(String(e)),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const kras = krasQuery.data?.kras ?? [];

      // Part I
      if (kras.length > 0) {
        const ratings = kras.map((kra) => ({
          kraId: kra.id,
          resultAchieved:
            pmsState.data?.kraRatings.find((r) => r.kraId === kra.id)?.resultAchieved ?? '—',
          finalRating: finalRatings[kra.id]?.rating ?? 3,
        }));
        await pmsApi.saveKraRatings({ cycleId, ratings });
      }

      // Part II
      const dims = dimsQuery.data?.items ?? [];
      if (dims.length > 0) {
        const bRatings = dims
          .filter((d) => behaviouralRatings[d.code]?.rating !== null)
          .map((d) => {
            const r = behaviouralRatings[d.code]!;
            return {
              dimensionCode: d.code,
              rating1to5: r.rating as number,
              rubricAnchorText: r.anchorText as string,
            };
          });
        if (bRatings.length > 0) {
          await pmsApi.saveBehavioural({ cycleId, ratings: bRatings });
        }
      }

      // Part III
      const validContribs = contributions.filter((c) => c.whenDate.trim() && c.achievement.trim());
      await pmsApi.saveContributions({ cycleId, contributions: validContribs });

      // Part V
      await pmsApi.saveCareer({
        cycleId,
        potentialWindow: career.potentialWindow,
        readyIn: career.readyIn || undefined,
        comments: career.comments || undefined,
      });
      await pmsApi.saveGrowth({
        cycleId,
        trainingNeeds: growth.trainingNeeds || undefined,
        comments: growth.comments || undefined,
      });

      // Part VI(a)
      if (appraiserComment.trim()) {
        await pmsApi.saveComment({ cycleId, role: 'appraiser', body: appraiserComment });
      }

      // Submit
      await pmsApi.submitAppraiser(cycleId);
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

  if (!APPRAISER_STATES.has(cycleState)) {
    return (
      <div className="p-8 max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold">Appraiser Review — FY {state.cycle.fy}</h1>
        <div className="bg-surface border border-hairline rounded-md p-4 text-sm text-ink-2">
          This cycle is in state <span className="font-medium text-ink">{cycleState}</span>.
          Appraiser editing is not currently available.
        </div>
        <Link to="/team" className="text-sm text-ink underline">
          Back to team
        </Link>
      </div>
    );
  }

  const kras = krasQuery.data?.kras ?? [];
  const dims = dimsQuery.data?.items ?? [];
  const existingResults: Record<string, string | null> = {};
  for (const r of state.kraRatings) {
    existingResults[r.kraId] = r.resultAchieved;
  }

  const ratedBehaviouralCount = Object.values(behaviouralRatings).filter(
    (r) => r.rating !== null,
  ).length;

  const steps: StepperStep[] = [
    {
      id: 'kra-ratings',
      title: 'Part I — KRA Ratings',
      description: 'Final ratings per KRA',
      content: (
        <KraFinalRatingsStep
          kras={kras}
          existingResults={existingResults}
          finalRatings={finalRatings}
          onChange={(kraId, rating) =>
            setFinalRatings((prev) => ({ ...prev, [kraId]: { rating } }))
          }
        />
      ),
    },
    {
      id: 'behavioural',
      title: 'Part II — Behavioural',
      description: `${ratedBehaviouralCount}/${dims.length} rated`,
      content: (
        <BehaviouralStep
          dimensions={dims}
          ratings={behaviouralRatings}
          onChange={(code, rating, anchorText) =>
            setBehaviouralRatings((prev) => ({ ...prev, [code]: { rating, anchorText } }))
          }
        />
      ),
      canAdvance: () => ratedBehaviouralCount === dims.length,
    },
    {
      id: 'contributions',
      title: 'Part III — Contributions',
      description: 'Staff bonus contributions',
      content: <ContributionsStep contributions={contributions} onChange={setContributions} />,
      canAdvance: () => contributions.reduce((s, c) => s + (c.weightPct || 0), 0) <= 5,
      optional: true,
    },
    {
      id: 'career-growth',
      title: 'Part V — Career &amp; Growth',
      description: 'Development planning',
      content: (
        <div className="space-y-4">
          <AiPanel
            title="Development Recommendations"
            queryKey={['ai', 'dev-recommendations', cycleId]}
            queryFn={() => aiApi.devRecommendations(cycleId).then((r) => r.output)}
          >
            {(output) => (
              <div className="space-y-2 text-sm">
                {output.training.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">Training</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-ink">
                      {output.training.map((t, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {output.stretch.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                      Stretch assignments
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5 text-ink">
                      {output.stretch.map((s, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {output.mentorship.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                      Mentorship
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5 text-ink">
                      {output.mentorship.map((m, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </AiPanel>
          <CareerGrowthStep
            career={career}
            growth={growth}
            onCareerChange={(field, value) => setCareer((prev) => ({ ...prev, [field]: value }))}
            onGrowthChange={(field, value) => setGrowth((prev) => ({ ...prev, [field]: value }))}
          />
        </div>
      ),
      canAdvance: () => career.potentialWindow.length > 0,
    },
    {
      id: 'sign',
      title: 'Part VI(a) — Sign',
      description: 'Appraiser comment',
      content: <AppraiserSignStep comment={appraiserComment} onChange={setAppraiserComment} />,
    },
    {
      id: 'submit',
      title: 'Submit',
      description: 'Forward to next level',
      content: (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-ink">Ready to submit?</h2>
          <p className="text-sm text-ink-2">
            Once submitted, the appraisal will be forwarded to the next-level reviewer. You can
            request it back via the return button below if corrections are needed.
          </p>
          {error && (
            <div className="rounded-sm border border-neg/30 bg-neg/5 p-3 text-sm text-neg">
              {error}
            </div>
          )}
          <ul className="text-sm text-ink-2 list-disc pl-4 space-y-1">
            <li>{kras.length} KRA(s) rated</li>
            <li>
              Behavioural: {ratedBehaviouralCount}/{dims.length} rated
            </li>
            <li>{contributions.length} contribution(s) added</li>
            <li>
              Potential window:{' '}
              {POTENTIAL_WINDOWS.find((pw) => pw.value === career.potentialWindow)?.label ??
                career.potentialWindow}
            </li>
          </ul>
        </div>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-8 py-5 border-b border-hairline bg-surface flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Appraiser Review — FY {state.cycle.fy}</h1>
          <p className="text-xs text-ink-2 mt-0.5">
            Complete all steps and submit to next-level reviewer.
          </p>
        </div>

        {/* Return to appraisee — secondary action */}
        <div className="flex items-center gap-3">
          {showReturn ? (
            <div className="flex items-center gap-2">
              <input
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                className="text-sm border border-hairline rounded-sm px-2 py-1 bg-white w-56"
                placeholder="Note for appraisee (optional)"
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
              Return to appraisee
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <StepperForm
          steps={steps}
          onComplete={() => submitMutation.mutateAsync()}
          submitLabel="Submit to next level"
        />
      </div>
    </div>
  );
}
