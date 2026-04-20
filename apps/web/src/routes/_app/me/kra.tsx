import { type KraDraft, KraPerspective, kraCreateBatch } from '@spa/shared';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { aiApi } from '../../../api/ai';
import { api } from '../../../api/client';
import { AiPanel } from '../../../components/ai/AiPanel';

export const Route = createFileRoute('/_app/me/kra')({ component: KraForm });

const emptyKra = (order: number): KraDraft => ({
  perspective: KraPerspective.Financial,
  description: '',
  weightPct: 25,
  measurement: '',
  target: '',
  order,
  rubric1to5: ['', '', '', '', ''],
});

function KraForm() {
  const qc = useQueryClient();
  const [qualityOpen, setQualityOpen] = useState<Record<number, boolean>>({});
  const cycle = useQuery({
    queryKey: ['cycle', 'current'],
    queryFn: () =>
      api<{ cycle: { id: string; fy: number; state: string } | null }>('/api/v1/cycle/current'),
  });

  // Load saved KRAs so we can show "Check quality" with real IDs
  const savedKras = useQuery({
    queryKey: ['kras', cycle.data?.cycle?.id],
    queryFn: () =>
      api<{ kras: Array<{ id: string; order: number }> }>(`/api/v1/kra/${cycle.data!.cycle!.id}`),
    enabled: !!cycle.data?.cycle?.id,
  });

  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('/api/v1/kra/draft', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cycle'] });
      qc.invalidateQueries({ queryKey: ['kras', cycle.data?.cycle?.id] });
    },
  });

  const submit = useMutation({
    mutationFn: (cycleId: string) => api(`/api/v1/kra/submit/${cycleId}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycle'] }),
  });

  const form = useForm({
    defaultValues: { kras: [emptyKra(0), emptyKra(1), emptyKra(2), emptyKra(3)] as KraDraft[] },
    onSubmit: async ({ value }) => {
      if (!cycle.data?.cycle) return;
      await save.mutateAsync(
        kraCreateBatch.parse({ cycleId: cycle.data.cycle.id, kras: value.kras }),
      );
    },
  });

  // useStore for reactive totalWeight so React re-renders on value changes
  const kras = form.useStore((state) => state.values.kras);
  const totalWeight = kras.reduce((s, k) => s + (k.weightPct ?? 0), 0);
  const valid = totalWeight === 100;

  // Map saved KRA index → id
  const kraIdByOrder: Record<number, string> = {};
  for (const k of savedKras.data?.kras ?? []) {
    kraIdByOrder[k.order] = k.id;
  }

  if (!cycle.data?.cycle) {
    return <div className="text-xs text-ink-2">No active cycle.</div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-lg font-semibold">Key Result Areas — FY {cycle.data.cycle.fy}</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <form.Field name="kras" mode="array">
          {(field) => (
            <div className="space-y-4">
              {field.state.value.map((_k, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: KRAs are fixed-position (3-5 slots), index is stable
                  key={i}
                  className="bg-surface border border-hairline rounded-md p-5 space-y-3"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-xs uppercase tracking-wider text-ink-2">KRA {i + 1}</span>
                    <form.Field name={`kras[${i}].perspective`}>
                      {(f) => (
                        <select
                          value={f.state.value}
                          onChange={(e) =>
                            f.handleChange(e.target.value as KraDraft['perspective'])
                          }
                          className="text-sm border border-hairline rounded-sm px-2 py-1 bg-surface"
                        >
                          {Object.values(KraPerspective).map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      )}
                    </form.Field>
                  </div>
                  <form.Field name={`kras[${i}].description`}>
                    {(f) => (
                      <textarea
                        value={f.state.value}
                        onChange={(e) => f.handleChange(e.target.value)}
                        rows={2}
                        className="block w-full text-sm border border-hairline rounded-sm p-2"
                        placeholder="Description"
                      />
                    )}
                  </form.Field>
                  <div className="grid grid-cols-2 gap-3">
                    <form.Field name={`kras[${i}].measurement`}>
                      {(f) => (
                        <input
                          value={f.state.value}
                          onChange={(e) => f.handleChange(e.target.value)}
                          className="text-sm border border-hairline rounded-sm p-2"
                          placeholder="Measurement"
                        />
                      )}
                    </form.Field>
                    <form.Field name={`kras[${i}].target`}>
                      {(f) => (
                        <input
                          value={f.state.value}
                          onChange={(e) => f.handleChange(e.target.value)}
                          className="text-sm border border-hairline rounded-sm p-2"
                          placeholder="Target"
                        />
                      )}
                    </form.Field>
                  </div>
                  <form.Field name={`kras[${i}].weightPct`}>
                    {(f) => (
                      <label className="text-xs text-ink-2">
                        Weight %
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={f.state.value}
                          onChange={(e) => f.handleChange(Number(e.target.value))}
                          className="ml-2 w-20 text-sm border border-hairline rounded-sm p-1"
                        />
                      </label>
                    )}
                  </form.Field>
                  <div className="grid grid-cols-5 gap-2">
                    {[0, 1, 2, 3, 4].map((idx) => (
                      <form.Field key={idx} name={`kras[${i}].rubric1to5[${idx}]`}>
                        {(f) => (
                          <input
                            value={f.state.value}
                            onChange={(e) => f.handleChange(e.target.value)}
                            className="text-xs border border-hairline rounded-sm p-2"
                            placeholder={`Anchor ${idx + 1}`}
                          />
                        )}
                      </form.Field>
                    ))}
                  </div>

                  {/* Check quality button — only available once KRA has a server ID */}
                  {kraIdByOrder[i] && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setQualityOpen((prev) => ({ ...prev, [i]: !prev[i] }))}
                        className="text-xs border border-hairline rounded-sm px-2 py-1 hover:bg-canvas text-ink-2 hover:text-ink"
                      >
                        {qualityOpen[i] ? 'Hide quality check' : 'Check quality'}
                      </button>
                      {qualityOpen[i] &&
                        (() => {
                          const savedKraId = kraIdByOrder[i] as string;
                          return (
                            <div className="mt-2">
                              <AiPanel
                                title="KRA Quality Check"
                                queryKey={['ai', 'kra-quality', savedKraId]}
                                queryFn={() => aiApi.kraQuality(savedKraId).then((r) => r.output)}
                                onRegenerate={() =>
                                  setQualityOpen((prev) => ({ ...prev, [i]: true }))
                                }
                              >
                                {(output) => (
                                  <div className="space-y-3 text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-ink-2">SMART score</span>
                                      <div className="flex-1 h-1.5 bg-canvas rounded-full overflow-hidden border border-hairline">
                                        <div
                                          className="h-full bg-ink rounded-full"
                                          style={{ width: `${output.smart_score}%` }}
                                        />
                                      </div>
                                      <span className="text-xs font-medium text-ink tabular-nums">
                                        {output.smart_score}/100
                                      </span>
                                    </div>
                                    {output.issues.length > 0 && (
                                      <div>
                                        <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                                          Issues
                                        </div>
                                        <ul className="list-disc pl-4 space-y-0.5 text-ink text-xs">
                                          {output.issues.map((issue, j) => (
                                            // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                                            <li key={j}>{issue}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {output.suggested_rewrite && (
                                      <div>
                                        <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                                          Suggested rewrite
                                        </div>
                                        <textarea
                                          readOnly
                                          value={output.suggested_rewrite}
                                          rows={3}
                                          className="block w-full text-xs border border-hairline rounded-sm p-2 bg-canvas text-ink"
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </AiPanel>
                            </div>
                          );
                        })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </form.Field>

        <div className="flex items-center justify-between bg-surface border border-hairline rounded-md p-4">
          <div className="text-sm">
            Total weight: <span className={valid ? 'text-pos' : 'text-neg'}>{totalWeight}%</span>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm">
              Save draft
            </button>
            <button
              type="button"
              disabled={!valid}
              onClick={() => cycle.data?.cycle && submit.mutate(cycle.data.cycle.id)}
              className="bg-ink text-white rounded-sm px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Submit for approval
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
