import { Link, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/hr/')({
  component: HrIndex,
});

function HrIndex() {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-lg font-semibold text-ink">HR Administration</h1>

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
      </div>
    </div>
  );
}
