import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ALL_CYCLE_STATES,
  HRA_FINALIZE_STATES,
  MID_YEAR_ELIGIBLE_STATE,
  PMS_ELIGIBLE_STATE,
  cycleApi,
} from '../../../api/cycle';
import type { CycleListItem, CycleState, DepartmentItem } from '../../../api/cycle';

export const Route = createFileRoute('/_app/hr/cycles')({
  component: HrCycles,
});

const PAGE_SIZE = 50;

function stateBadge(state: CycleState): string {
  const map: Record<CycleState, string> = {
    kra_drafting: 'KRA Drafting',
    kra_pending_approval: 'KRA Pending',
    kra_approved: 'KRA Approved',
    mid_year_open: 'Mid-year Open',
    mid_year_submitted: 'Mid-year Submitted',
    mid_year_done: 'Mid-year Done',
    pms_self_review: 'PMS Self-review',
    pms_awaiting_appraiser: 'PMS Awaiting Appraiser',
    pms_awaiting_next_lvl: 'PMS Awaiting Next-level',
    pms_awaiting_hra: 'PMS Awaiting HRA',
    pms_finalized: 'PMS Finalized',
  };
  return map[state] ?? state;
}

function HrCycles() {
  const qc = useQueryClient();

  // ── Filters ────────────────────────────────────────────────────────────────
  const [stateFilter, setStateFilter] = useState<CycleState | ''>('');
  const [fyFilter, setFyFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [page, setPage] = useState(0);

  // ── Queries ────────────────────────────────────────────────────────────────
  const deptsQuery = useQuery({
    queryKey: ['cycle', 'departments'],
    queryFn: () => cycleApi.getDepartments(),
  });

  const cyclesQuery = useQuery({
    queryKey: ['cycle', 'list', stateFilter, fyFilter, deptFilter, page],
    queryFn: () => {
      const params: import('../../../api/cycle').CycleListParams = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      if (stateFilter) params.state = stateFilter;
      if (fyFilter) params.fy = Number(fyFilter);
      if (deptFilter) params.departmentId = deptFilter;
      return cycleApi.list(params);
    },
  });

  // ── Per-row actions ────────────────────────────────────────────────────────
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowSuccess, setRowSuccess] = useState<Record<string, string>>({});

  const openPmsMutation = useMutation({
    mutationFn: (cycleId: string) => cycleApi.openPmsForStaff(cycleId),
    onSuccess: (_, cycleId) => {
      setRowSuccess((s) => ({ ...s, [cycleId]: 'PMS window opened' }));
      setRowError((s) => {
        const n = { ...s };
        delete n[cycleId];
        return n;
      });
      qc.invalidateQueries({ queryKey: ['cycle', 'list'] });
    },
    onError: (e, cycleId) => {
      setRowError((s) => ({ ...s, [cycleId]: String(e) }));
    },
  });

  const openMidYearMutation = useMutation({
    mutationFn: (cycleId: string) => cycleApi.openMidYearForStaff(cycleId),
    onSuccess: (_, cycleId) => {
      setRowSuccess((s) => ({ ...s, [cycleId]: 'Mid-year window opened' }));
      setRowError((s) => {
        const n = { ...s };
        delete n[cycleId];
        return n;
      });
      qc.invalidateQueries({ queryKey: ['cycle', 'list'] });
    },
    onError: (e, cycleId) => {
      setRowError((s) => ({ ...s, [cycleId]: String(e) }));
    },
  });

  // ── Client-side name search ────────────────────────────────────────────────
  const allItems: CycleListItem[] = cyclesQuery.data?.items ?? [];
  const filtered = nameSearch.trim()
    ? allItems.filter(
        (r) =>
          r.staffName.toLowerCase().includes(nameSearch.toLowerCase()) ||
          r.employeeNo.toLowerCase().includes(nameSearch.toLowerCase()),
      )
    : allItems;

  const total = cyclesQuery.data?.total ?? 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const hasPrev = page > 0;

  const depts: DepartmentItem[] = deptsQuery.data?.items ?? [];

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">HR Cycles</h1>
        <div className="flex items-center gap-3">
          <Link to="/hr/bulk-windows" className="text-sm text-ink underline">
            Bulk window operations
          </Link>
          <Link to="/hr" className="text-sm text-ink-2 underline">
            Back to HR
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-surface border border-hairline rounded-md p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-state" className="text-xs text-ink-2">
            State
          </label>
          <select
            id="filter-state"
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value as CycleState | '');
              setPage(0);
            }}
            className="text-sm border border-hairline rounded-sm px-2 py-1 bg-white"
          >
            <option value="">All states</option>
            {ALL_CYCLE_STATES.map((s) => (
              <option key={s} value={s}>
                {stateBadge(s)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-fy" className="text-xs text-ink-2">
            FY
          </label>
          <input
            id="filter-fy"
            type="number"
            value={fyFilter}
            onChange={(e) => {
              setFyFilter(e.target.value);
              setPage(0);
            }}
            placeholder="e.g. 2026"
            className="text-sm border border-hairline rounded-sm px-2 py-1 w-24 bg-white"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-dept" className="text-xs text-ink-2">
            Department
          </label>
          <select
            id="filter-dept"
            value={deptFilter}
            onChange={(e) => {
              setDeptFilter(e.target.value);
              setPage(0);
            }}
            className="text-sm border border-hairline rounded-sm px-2 py-1 bg-white"
          >
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-name" className="text-xs text-ink-2">
            Name / Employee #
          </label>
          <input
            id="filter-name"
            type="text"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Search…"
            className="text-sm border border-hairline rounded-sm px-2 py-1 bg-white"
          />
        </div>

        {(stateFilter || fyFilter || deptFilter || nameSearch) && (
          <button
            type="button"
            onClick={() => {
              setStateFilter('');
              setFyFilter('');
              setDeptFilter('');
              setNameSearch('');
              setPage(0);
            }}
            className="text-sm text-ink-2 hover:text-ink hover:underline self-end pb-1"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {cyclesQuery.isLoading && <div className="text-sm text-ink-2">Loading cycles…</div>}

      {cyclesQuery.isError && <div className="text-sm text-neg">Failed to load cycles.</div>}

      {!cyclesQuery.isLoading && !cyclesQuery.isError && (
        <>
          <div className="text-xs text-ink-2">
            Showing {filtered.length} of {total} cycles
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-2 uppercase tracking-wider">
                  <th className="py-2 pr-4">Emp #</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Department</th>
                  <th className="py-2 pr-4">FY</th>
                  <th className="py-2 pr-4">State</th>
                  <th className="py-2 pr-4">Mid-year</th>
                  <th className="py-2 pr-4">PMS finalized</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-ink-2">
                      No cycles found.
                    </td>
                  </tr>
                )}
                {filtered.map((row) => {
                  const canOpenPms = row.state === PMS_ELIGIBLE_STATE;
                  const canOpenMidYear = row.state === MID_YEAR_ELIGIBLE_STATE;
                  const canView = HRA_FINALIZE_STATES.has(row.state);
                  const isSubmitting =
                    (openPmsMutation.isPending && openPmsMutation.variables === row.id) ||
                    (openMidYearMutation.isPending && openMidYearMutation.variables === row.id);

                  return (
                    <tr key={row.id} className="border-b border-hairline hover:bg-canvas/50">
                      <td className="py-2 pr-4 font-mono text-xs">{row.employeeNo}</td>
                      <td className="py-2 pr-4">{row.staffName}</td>
                      <td className="py-2 pr-4 text-ink-2">{row.departmentName}</td>
                      <td className="py-2 pr-4">{row.fy}</td>
                      <td className="py-2 pr-4">
                        <span className="inline-block text-xs bg-canvas border border-hairline rounded-full px-2 py-0.5">
                          {stateBadge(row.state)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-ink-2">
                        {row.midYearAt ? new Date(row.midYearAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2 pr-4 text-xs text-ink-2">
                        {row.pmsFinalizedAt
                          ? new Date(row.pmsFinalizedAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {canOpenPms && (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => openPmsMutation.mutate(row.id)}
                              className="text-xs px-2 py-1 rounded-sm border border-hairline hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Open PMS
                            </button>
                          )}
                          {canOpenMidYear && (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => openMidYearMutation.mutate(row.id)}
                              className="text-xs px-2 py-1 rounded-sm border border-hairline hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Open Mid-year
                            </button>
                          )}
                          {canView && (
                            <Link
                              to="/hr/cycle/$cycleId/finalize"
                              params={{ cycleId: row.id }}
                              className="text-xs px-2 py-1 rounded-sm border border-hairline hover:bg-canvas"
                            >
                              View
                            </Link>
                          )}
                          {!canOpenPms && !canOpenMidYear && !canView && (
                            <span className="text-xs text-ink-2">—</span>
                          )}
                        </div>
                        {rowSuccess[row.id] && (
                          <div className="text-xs text-pos mt-1">{rowSuccess[row.id]}</div>
                        )}
                        {rowError[row.id] && (
                          <div className="text-xs text-neg mt-1">{rowError[row.id]}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="text-sm px-3 py-1.5 border border-hairline rounded-sm hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-sm text-ink-2">
              Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <button
              type="button"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="text-sm px-3 py-1.5 border border-hairline rounded-sm hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
