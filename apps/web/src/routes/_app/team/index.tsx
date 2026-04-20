import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { dashboardsApi } from '../../../api/dashboards';
import { StatCard } from '../../../components/dashboard/StatCard';
import { TrajectoryBar } from '../../../components/dashboard/TrajectoryBar';

export const Route = createFileRoute('/_app/team/')({
  component: TeamDashboard,
});

function TeamDashboard() {
  const q = useQuery({
    queryKey: ['dashboards', 'team'],
    queryFn: () => dashboardsApi.team(),
  });

  if (q.isLoading) {
    return <div className="text-sm text-ink-2">Loading team dashboard…</div>;
  }

  if (q.isError) {
    return <div className="text-sm text-neg">Failed to load team dashboard.</div>;
  }

  const data = q.data;
  if (!data) return null;

  const { directReports, pendingActions, stats } = data;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-ink">Team Dashboard</h1>
        <p className="text-xs text-ink-2 mt-1">Performance overview for your direct reports.</p>
      </div>

      {/* ── Summary stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Direct reports" value={stats.total} />
        <StatCard label="Completed" value={stats.completed} helpText="Cycles finalized" />
        <StatCard label="In progress" value={stats.inProgress} helpText="Cycles in progress" />
      </div>

      {/* ── Pending actions ────────────────────────────────────────────────── */}
      {pendingActions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-ink mb-3">Pending your action</h2>
          <div className="space-y-2">
            {pendingActions.map((action) => (
              <div
                key={action.cycleId}
                className="flex items-center justify-between bg-surface border border-hairline rounded-md px-4 py-3"
              >
                <div>
                  <div className="text-sm text-ink">{action.staffName}</div>
                  <div className="text-xs text-ink-2">{action.action}</div>
                </div>
                <Link
                  to="/team/cycle/$cycleId/review"
                  params={{ cycleId: action.cycleId }}
                  className="text-xs border border-hairline rounded-sm px-3 py-1.5 text-ink hover:bg-canvas transition-colors"
                >
                  Review
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Direct reports trajectory table ───────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-ink mb-3">Direct reports — trajectory</h2>

        {directReports.length === 0 ? (
          <div className="text-sm text-ink-2 bg-surface border border-hairline rounded-md p-4">
            No direct reports found.
          </div>
        ) : (
          <div className="bg-surface border border-hairline rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Name
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Employee No
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    State
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Score
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium min-w-[180px]">
                    Trajectory (June → Now)
                  </th>
                </tr>
              </thead>
              <tbody>
                {directReports.map((r) => (
                  <tr key={r.staffId} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3 text-ink">{r.name}</td>
                    <td className="px-4 py-3 text-ink-2 font-mono text-xs">{r.employeeNo}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-canvas border border-hairline rounded-sm px-1.5 py-0.5 text-ink-2">
                        {r.currentCycleState ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.scoreTotal != null ? r.scoreTotal.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <TrajectoryBar june={r.trajectoryJune} current={r.trajectoryNow} max={5} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
