import { createFileRoute } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kraCreateBatch, KraPerspective, type KraDraft } from '@spa/shared';
import { api } from '../../../api/client';

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
  const cycle = useQuery({
    queryKey: ['cycle', 'current'],
    queryFn: () =>
      api<{ cycle: { id: string; fy: number; state: string } | null }>('/api/v1/cycle/current'),
  });

  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('/api/v1/kra/draft', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycle'] }),
  });

  const submit = useMutation({
    mutationFn: (cycleId: string) =>
      api(`/api/v1/kra/submit/${cycleId}`, { method: 'POST' }),
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
                <div key={i} className="bg-surface border border-hairline rounded-md p-5 space-y-3">
                  <div className="flex items-center gap-4">
                    <span className="text-xs uppercase tracking-wider text-ink-2">KRA {i + 1}</span>
                    <form.Field name={`kras[${i}].perspective`}>
                      {(f) => (
                        <select
                          value={f.state.value}
                          onChange={(e) => f.handleChange(e.target.value as KraDraft['perspective'])}
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
