import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { type BulkResult, type BulkScope, cycleApi } from '../../../api/cycle';
import type { DepartmentItem, OrgStaffItem } from '../../../api/cycle';

export const Route = createFileRoute('/_app/hr/bulk-windows')({
  component: BulkWindows,
});

type WindowKind = 'pms' | 'mid_year';

function BulkWindows() {
  const [activeTab, setActiveTab] = useState<WindowKind>('pms');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [resultKind, setResultKind] = useState<string>('');

  const deptsQuery = useQuery({
    queryKey: ['cycle', 'departments'],
    queryFn: () => cycleApi.getDepartments(),
  });

  const staffQuery = useQuery({
    queryKey: ['cycle', 'org-staff'],
    queryFn: () => cycleApi.getOrgStaff(),
  });

  const depts: DepartmentItem[] = deptsQuery.data?.items ?? [];
  const orgStaff: OrgStaffItem[] = staffQuery.data?.items ?? [];

  const doOpen = (scope: BulkScope, label: string) => {
    setResult(null);
    setResultKind(label);
    if (activeTab === 'pms') {
      pmsBulkMutation.mutate(scope);
    } else {
      midYearBulkMutation.mutate(scope);
    }
  };

  const pmsBulkMutation = useMutation({
    mutationFn: (scope: BulkScope) => cycleApi.openPmsBulk(scope),
    onSuccess: (data) => setResult(data),
    onError: (e) => setResult({ opened: 0, failed: [{ cycleId: '', error: String(e) }] }),
  });

  const midYearBulkMutation = useMutation({
    mutationFn: (scope: BulkScope) => cycleApi.openMidYearBulk(scope),
    onSuccess: (data) => setResult(data),
    onError: (e) => setResult({ opened: 0, failed: [{ cycleId: '', error: String(e) }] }),
  });

  const isPending = pmsBulkMutation.isPending || midYearBulkMutation.isPending;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Bulk Window Operations</h1>
        <div className="flex items-center gap-3">
          <Link to="/hr/cycles" className="text-sm text-ink underline">
            Cycles list
          </Link>
          <Link to="/hr" className="text-sm text-ink-2 underline">
            Back to HR
          </Link>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-hairline">
        <button
          type="button"
          onClick={() => {
            setActiveTab('pms');
            setResult(null);
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'pms'
              ? 'border-ink text-ink'
              : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          Open PMS Window
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('mid_year');
            setResult(null);
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'mid_year'
              ? 'border-ink text-ink'
              : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          Open Mid-Year Window
        </button>
      </div>

      <div className="text-xs text-ink-2">
        {activeTab === 'pms'
          ? 'Eligible state: mid_year_done. Opens PMS self-review for each matching cycle.'
          : 'Eligible state: kra_approved. Opens mid-year checkpoint for each matching cycle.'}
      </div>

      {/* Three cards */}
      <div className="grid gap-4">
        <OrgCard
          kind={activeTab}
          isPending={isPending}
          onConfirm={() => doOpen({ scope: 'org' }, 'whole org')}
        />
        <DepartmentCard
          kind={activeTab}
          depts={depts}
          isPending={isPending}
          onConfirm={(departmentId) => doOpen({ scope: 'department', departmentId }, 'department')}
        />
        <StaffPickerCard
          kind={activeTab}
          orgStaff={orgStaff}
          isPending={isPending}
          onConfirm={(staffIds) => doOpen({ scope: 'staffIds', staffIds }, 'specific staff')}
        />
      </div>

      {/* Result panel */}
      {result && <ResultPanel result={result} label={resultKind} kind={activeTab} />}
    </div>
  );
}

// ── Card components ───────────────────────────────────────────────────────────

function OrgCard({
  kind,
  isPending,
  onConfirm,
}: {
  kind: WindowKind;
  isPending: boolean;
  onConfirm: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const label = kind === 'pms' ? 'Open PMS window' : 'Open Mid-year window';

  return (
    <div className="bg-surface border border-hairline rounded-md p-5 space-y-3">
      <div className="text-sm font-medium text-ink">Open for whole org</div>
      <p className="text-xs text-ink-2">
        Opens the {kind === 'pms' ? 'PMS self-review' : 'mid-year'} window for every eligible cycle
        in your organisation. Non-eligible cycles are silently skipped.
      </p>
      {!confirm ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={isPending}
          className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {label} for entire org
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setConfirm(false);
              onConfirm();
            }}
            disabled={isPending}
            className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? 'Processing…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="text-sm text-ink-2 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function DepartmentCard({
  kind,
  depts,
  isPending,
  onConfirm,
}: {
  kind: WindowKind;
  depts: DepartmentItem[];
  isPending: boolean;
  onConfirm: (departmentId: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const [confirm, setConfirm] = useState(false);
  const label = kind === 'pms' ? 'Open PMS window' : 'Open Mid-year window';

  return (
    <div className="bg-surface border border-hairline rounded-md p-5 space-y-3">
      <div className="text-sm font-medium text-ink">Open for department</div>
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-dept-select" className="text-xs text-ink-2">
            Department
          </label>
          <select
            id="bulk-dept-select"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setConfirm(false);
            }}
            className="text-sm border border-hairline rounded-sm px-2 py-1 bg-white"
          >
            <option value="">Select a department…</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {selected && !confirm && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirm(true)}
            className="text-sm px-3 py-1.5 rounded-sm border border-hairline hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed self-end"
          >
            {label}
          </button>
        )}

        {selected && confirm && (
          <div className="flex items-center gap-3 self-end">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setConfirm(false);
                onConfirm(selected);
              }}
              className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? 'Processing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="text-sm text-ink-2 hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StaffPickerCard({
  kind,
  orgStaff,
  isPending,
  onConfirm,
}: {
  kind: WindowKind;
  orgStaff: OrgStaffItem[];
  isPending: boolean;
  onConfirm: (staffIds: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const label = kind === 'pms' ? 'Open PMS window' : 'Open Mid-year window';

  const filtered = search.trim()
    ? orgStaff.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.employeeNo.toLowerCase().includes(search.toLowerCase()),
      )
    : orgStaff;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirm(false);
  };

  return (
    <div className="bg-surface border border-hairline rounded-md p-5 space-y-3">
      <div className="text-sm font-medium text-ink">Open for specific staff</div>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or employee #…"
          className="text-sm border border-hairline rounded-sm px-2 py-1 bg-white max-w-xs"
        />
        <div className="max-h-48 overflow-y-auto border border-hairline rounded-sm bg-white divide-y divide-hairline">
          {filtered.length === 0 && (
            <div className="p-3 text-xs text-ink-2">
              {orgStaff.length === 0 ? 'Loading…' : 'No staff match.'}
            </div>
          )}
          {filtered.slice(0, 100).map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-canvas cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
                className="shrink-0"
              />
              <span className="text-sm">{s.name}</span>
              <span className="text-xs text-ink-2 font-mono ml-auto">{s.employeeNo}</span>
            </label>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="text-xs text-ink-2">{selected.size} staff selected</div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3">
          {!confirm ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirm(true)}
              className="text-sm px-3 py-1.5 rounded-sm border border-hairline hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {label} for {selected.size} staff
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setConfirm(false);
                  onConfirm(Array.from(selected));
                }}
                className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending ? 'Processing…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="text-sm text-ink-2 hover:underline"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Result panel ──────────────────────────────────────────────────────────────

function ResultPanel({
  result,
  label,
  kind,
}: {
  result: BulkResult;
  label: string;
  kind: WindowKind;
}) {
  const windowName = kind === 'pms' ? 'PMS' : 'mid-year';
  return (
    <div
      className={`rounded-md border p-4 space-y-2 ${
        result.failed.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-pos/30 bg-pos/5'
      }`}
    >
      <div className="text-sm font-medium text-ink">
        Result — {windowName} window for {label}
      </div>
      <div className="text-sm">
        <span className="text-pos font-medium">{result.opened}</span> cycle
        {result.opened !== 1 ? 's' : ''} opened.
        {result.failed.length > 0 && (
          <span className="text-amber-700 ml-2">{result.failed.length} failed.</span>
        )}
      </div>
      {result.failed.length > 0 && (
        <ul className="text-xs text-amber-800 space-y-1 mt-2">
          {result.failed
            .filter((f) => f.cycleId)
            .map((f) => (
              <li key={f.cycleId} className="font-mono">
                {f.cycleId}: {f.error}
              </li>
            ))}
          {result.failed
            .filter((f) => !f.cycleId)
            .map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: error-only fallback list
              <li key={i}>{f.error}</li>
            ))}
        </ul>
      )}
    </div>
  );
}
