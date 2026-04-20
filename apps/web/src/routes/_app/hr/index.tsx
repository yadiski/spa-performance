import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { dashboardsApi } from '../../../api/dashboards';
import { StatCard } from '../../../components/dashboard/StatCard';

export const Route = createFileRoute('/_app/hr/')({
  component: HrIndex,
});

function HrIndex() {
  const dashQ = useQuery({
    queryKey: ['dashboards', 'hr'],
    queryFn: () => dashboardsApi.hr(),
    // Non-HRA users will get a 403 — swallow the error gracefully
    retry: false,
  });

  const isHrDash = !dashQ.isError && dashQ.data != null;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-ink">HR Administration</h1>
      </div>

      {/* ── Org-wide dashboard (HRA only) ────────────────────────────────── */}
      {isHrDash &&
        (() => {
          const { rollup, stateCounts, departments } = dashQ.data!;

          // Build score distribution buckets from dept data (approximate from org-level)
          // The rollup doesn't carry distribution directly, so we show a placeholder-style
          // bucket summary from stateCounts
          const stateEntries = Object.entries(stateCounts);

          return (
            <div className="space-y-6">
              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="Total cycles" value={rollup.totalCycles} helpText="Current FY" />
                <StatCard label="Finalized" value={rollup.finalizedCycles} />
                <StatCard
                  label="Avg score"
                  value={rollup.avgScore != null ? rollup.avgScore.toFixed(2) : '—'}
                  helpText="Across finalized cycles"
                />
              </div>

              {/* State counts */}
              {stateEntries.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-ink mb-3">Cycle states (current FY)</h2>
                  <div className="bg-surface border border-hairline rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-hairline">
                          <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                            State
                          </th>
                          <th className="text-right px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                            Count
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stateEntries.map(([state, count]) => (
                          <tr key={state} className="border-b border-hairline last:border-0">
                            <td className="px-4 py-2.5">
                              <span className="text-xs bg-canvas border border-hairline rounded-sm px-1.5 py-0.5 text-ink-2">
                                {state}
                              </span>
                            </td>
                            <td
                              className="px-4 py-2.5 text-right text-ink"
                              style={{ fontVariantNumeric: 'tabular-nums' }}
                            >
                              {count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Per-department breakdown */}
              {departments.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-ink mb-3">Department breakdown</h2>
                  <div className="bg-surface border border-hairline rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-hairline">
                          <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                            Department
                          </th>
                          <th className="text-right px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                            Total
                          </th>
                          <th className="text-right px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                            Finalized
                          </th>
                          <th className="text-right px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                            Avg score
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {departments.map((d) => (
                          <tr key={d.id} className="border-b border-hairline last:border-0">
                            <td className="px-4 py-2.5 text-ink">{d.name || d.id.slice(0, 8)}</td>
                            <td
                              className="px-4 py-2.5 text-right text-ink-2"
                              style={{ fontVariantNumeric: 'tabular-nums' }}
                            >
                              {d.totalCycles}
                            </td>
                            <td
                              className="px-4 py-2.5 text-right text-ink-2"
                              style={{ fontVariantNumeric: 'tabular-nums' }}
                            >
                              {d.finalizedCycles}
                            </td>
                            <td
                              className="px-4 py-2.5 text-right text-ink-2"
                              style={{ fontVariantNumeric: 'tabular-nums' }}
                            >
                              {d.avgScore != null ? d.avgScore.toFixed(2) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      {/* ── Navigation links (always shown) ──────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-ink mb-3">Administration</h2>
        <div className="grid gap-4">
          <Link
            to="/hr/cycles"
            className="block bg-surface border border-hairline rounded-md p-5 hover:border-ink/30 transition-colors group"
          >
            <div className="text-sm font-medium text-ink group-hover:underline">Cycles</div>
            <div className="text-xs text-ink-2 mt-1">
              View and manage all performance cycles in your organisation. Open PMS and mid-year
              windows per staff member, view finalized reviews.
            </div>
          </Link>

          <Link
            to="/hr/bulk-windows"
            className="block bg-surface border border-hairline rounded-md p-5 hover:border-ink/30 transition-colors group"
          >
            <div className="text-sm font-medium text-ink group-hover:underline">
              Bulk window operations
            </div>
            <div className="text-xs text-ink-2 mt-1">
              Open PMS or mid-year windows for all eligible cycles in a single operation — by whole
              org, by department, or for a specific set of staff.
            </div>
          </Link>

          <Link
            to="/hr/calibration"
            className="block bg-surface border border-hairline rounded-md p-5 hover:border-ink/30 transition-colors group"
          >
            <div className="text-sm font-medium text-ink group-hover:underline">Calibration</div>
            <div className="text-xs text-ink-2 mt-1">
              Review same-grade cohort matrix and run the AI calibration assistant with manual
              override support.
            </div>
          </Link>

          <Link
            to="/hr/exports"
            className="block bg-surface border border-hairline rounded-md p-5 hover:border-ink/30 transition-colors group"
          >
            <div className="text-sm font-medium text-ink group-hover:underline">Exports</div>
            <div className="text-xs text-ink-2 mt-1">
              Generate and download org-wide PMS snapshots as Excel workbooks.
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
