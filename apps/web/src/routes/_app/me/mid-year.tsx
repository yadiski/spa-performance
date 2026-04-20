import { type MidYearKraUpdate, midYearSave } from '@spa/shared';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { aiApi } from '../../../api/ai';
import { api } from '../../../api/client';
import { AiPanel } from '../../../components/ai/AiPanel';

export const Route = createFileRoute('/_app/me/mid-year')({ component: MidYearForm });

type KraRow = {
  id: string;
  description: string;
  perspective: string;
  weightPct: number;
};

function MidYearForm() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');

  const cycle = useQuery({
    queryKey: ['cycle', 'current'],
    queryFn: () =>
      api<{ cycle: { id: string; fy: number; state: string } | null }>('/api/v1/cycle/current'),
  });

  const kras = useQuery({
    queryKey: ['kras', cycle.data?.cycle?.id],
    queryFn: () => api<{ kras: KraRow[] }>(`/api/v1/kra/${cycle.data!.cycle!.id}`),
    enabled: !!cycle.data?.cycle?.id,
  });

  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('/api/v1/mid-year/save', { method: 'POST', body: JSON.stringify(body) }),
    onMutate: () => setSaved('saving'),
    onSuccess: () => {
      setSaved('saved');
      setTimeout(() => setSaved('idle'), 1500);
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      api('/api/v1/mid-year/submit', {
        method: 'POST',
        body: JSON.stringify({ cycleId: cycle.data!.cycle!.id }),
      }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const form = useForm({
    defaultValues: {
      updates: [] as MidYearKraUpdate[],
      summary: '',
    },
    onSubmit: async ({ value }) => {
      if (!cycle.data?.cycle) return;
      await save.mutateAsync(
        midYearSave.parse({
          cycleId: cycle.data.cycle.id,
          updates: value.updates,
          summary: value.summary || undefined,
        }),
      );
    },
  });

  if (!cycle.data?.cycle) return <div className="text-xs text-ink-2">No active cycle.</div>;

  const cycleState = cycle.data.cycle.state;
  const MID_YEAR_SUBMITTED_STATES = new Set([
    'mid_year_submitted',
    'mid_year_done',
    'pms_self_review',
    'pms_awaiting_appraiser',
    'pms_awaiting_next_lvl',
    'pms_awaiting_hra',
    'pms_finalized',
  ]);

  if (cycleState !== 'mid_year_open') {
    return (
      <div className="max-w-2xl space-y-4 p-4">
        {MID_YEAR_SUBMITTED_STATES.has(cycleState) && (
          <AiPanel
            title="Mid-year Nudges"
            queryKey={['ai', 'mid-year-nudges', cycle.data.cycle.id]}
            queryFn={() => aiApi.midYearNudges(cycle.data!.cycle!.id).then((r) => r.output)}
          >
            {(output) => (
              <div className="space-y-3 text-sm">
                {output.per_kra_nudge.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                      Per-KRA nudges
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-ink">
                      {output.per_kra_nudge.map((n, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated list; kra_id may not be unique across runs
                        <li key={i}>{n.nudge}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {output.overall_focus && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                      Overall focus
                    </div>
                    <p className="text-ink">{output.overall_focus}</p>
                  </div>
                )}
              </div>
            )}
          </AiPanel>
        )}
        <div className="text-xs text-ink-2">
          Mid-year window is not currently open. Current cycle state: {cycleState}
        </div>
      </div>
    );
  }

  // Initialize updates once kras are loaded and form is empty.
  const kraList = kras.data?.kras ?? [];
  if (kraList.length > 0 && form.getFieldValue('updates').length === 0) {
    form.setFieldValue(
      'updates',
      kraList.map((k) => ({ kraId: k.id, resultAchieved: '', informalRating: 3 })),
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-lg font-semibold">Mid-year checkpoint — FY {cycle.data.cycle.fy}</h1>
      <p className="text-sm text-ink-2">
        Review each KRA and share what you've delivered so far plus an informal 1-5 self-rating.
        This is not the year-end assessment.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <form.Field name="updates" mode="array">
          {(field) =>
            field.state.value.map((_u, i) => {
              const kra = kraList[i];
              if (!kra) return null;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position KRAs
                  key={i}
                  className="bg-surface border border-hairline rounded-md p-5 space-y-3"
                >
                  <div className="flex items-baseline justify-between">
                    <div className="text-xs uppercase tracking-wider text-ink-2">
                      {kra.perspective}
                    </div>
                    <div className="text-xs text-ink-2">{kra.weightPct}%</div>
                  </div>
                  <div className="text-sm">{kra.description}</div>
                  <form.Field name={`updates[${i}].resultAchieved`}>
                    {(f) => (
                      <textarea
                        value={f.state.value}
                        onChange={(e) => f.handleChange(e.target.value)}
                        rows={3}
                        className="block w-full text-sm border border-hairline rounded-sm p-2"
                        placeholder="What have you delivered on this KRA so far?"
                      />
                    )}
                  </form.Field>
                  <form.Field name={`updates[${i}].informalRating`}>
                    {(f) => (
                      <fieldset className="flex items-center gap-2">
                        <legend className="text-xs text-ink-2">Informal rating:</legend>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => f.handleChange(n)}
                            className={`w-8 h-8 text-sm rounded-sm border border-hairline ${
                              f.state.value === n ? 'bg-ink text-white' : 'bg-surface'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </fieldset>
                    )}
                  </form.Field>
                </div>
              );
            })
          }
        </form.Field>

        <form.Field name="summary">
          {(f) => (
            <div>
              <label className="block text-xs text-ink-2 mb-1" htmlFor="summary-field">
                Overall summary (optional)
              </label>
              <textarea
                id="summary-field"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
                rows={3}
                className="block w-full text-sm border border-hairline rounded-sm p-2"
              />
            </div>
          )}
        </form.Field>

        <div className="flex items-center justify-between bg-surface border border-hairline rounded-md p-4">
          <div className="text-xs text-ink-2">
            {saved === 'saving' && 'Saving...'}
            {saved === 'saved' && 'Saved.'}
          </div>
          <div className="flex gap-3">
            <button type="submit" className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm">
              Save draft
            </button>
            <button
              type="button"
              onClick={() => submit.mutate()}
              className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm"
            >
              Submit for review
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
