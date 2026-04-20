import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { dashboardsApi } from '../../../api/dashboards';
import type { StaffSearchHit } from '../../../api/search';
import { DistributionHistogram } from '../../../components/dashboard/DistributionHistogram';
import { StatCard } from '../../../components/dashboard/StatCard';
import { StaffSearchCombobox } from '../../../components/search/StaffSearchCombobox';

export const Route = createFileRoute('/_app/department/')({
  component: DepartmentDashboard,
});

function DepartmentDashboard() {
  const [search, setSearch] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<StaffSearchHit | null>(null);

  const q = useQuery({
    queryKey: ['dashboards', 'dept'],
    queryFn: () => dashboardsApi.dept(),
  });

  if (q.isLoading) {
    return <div className="text-sm text-ink-2">Loading department dashboard…</div>;
  }

  if (q.isError) {
    return (
      <div className="text-sm text-neg">
        Failed to load department dashboard. You may not have department-head or HRA access.
      </div>
    );
  }

  const data = q.data;
  if (!data) return null;

  const { department, rollup, distribution, cycles } = data;

  // Client-side filter — prefer selected staff from combobox, fallback to text search
  const filteredCycles = selectedStaff
    ? cycles.filter((c) => c.staffName === selectedStaff.name)
    : search.trim()
      ? cycles.filter((c) => c.staffName.toLowerCase().includes(search.trim().toLowerCase()))
      : cycles;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-ink">Department Dashboard</h1>
        <p className="text-xs text-ink-2 mt-1">{department.name}</p>
      </div>

      {/* ── Rollup stat cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total cycles" value={rollup.totalCycles} />
        <StatCard label="Finalized" value={rollup.finalizedCycles} />
        <StatCard
          label="Avg score"
          value={rollup.avgScore != null ? rollup.avgScore.toFixed(2) : '—'}
          helpText="Across finalized cycles"
        />
      </div>

      {/* ── Score distribution ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-ink mb-3">Score distribution</h2>
        <div className="bg-surface border border-hairline rounded-md p-4">
          {distribution.length === 0 ? (
            <div className="text-sm text-ink-2">No finalized scores yet.</div>
          ) : (
            <DistributionHistogram
              buckets={distribution.map((d) => ({ label: d.bucket, count: d.count }))}
              maxHeight={180}
            />
          )}
        </div>
      </div>

      {/* ── Cycles table ───────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">Cycles</h2>
          <div className="w-64">
            <StaffSearchCombobox
              scope="dept"
              placeholder="Search by name…"
              onSelect={(staff) => {
                setSelectedStaff(staff);
                setSearch('');
              }}
            />
          </div>
        </div>

        {filteredCycles.length === 0 ? (
          <div className="text-sm text-ink-2 bg-surface border border-hairline rounded-md p-4">
            {search ? 'No cycles match your search.' : 'No cycles in this department.'}
          </div>
        ) : (
          <div className="bg-surface border border-hairline rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Staff
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    State
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-ink-2 font-medium">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCycles.map((c) => (
                  <tr key={c.cycleId} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3 text-ink">{c.staffName}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-canvas border border-hairline rounded-sm px-1.5 py-0.5 text-ink-2">
                        {c.state}
                      </span>
                    </td>
                    <td
                      className="px-4 py-3 text-ink-2"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {c.scoreTotal != null ? c.scoreTotal.toFixed(2) : '—'}
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
