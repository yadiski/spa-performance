import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { api } from '../../../api/client';

type MeResponse = {
  actor: { userId: string; staffId: string | null; roles: string[]; email: string };
};
type MyCycle = { id: string; fy: number; state: string };

export const Route = createFileRoute('/_app/me/')({ component: Me });

// Human-readable state labels for the Me landing.
const stateLabels: Record<string, string> = {
  kra_drafting: 'KRA drafting',
  kra_pending_approval: 'KRA pending approval',
  kra_approved: 'KRA approved — waiting for mid-year',
  mid_year_open: 'Mid-year check-in open',
  mid_year_submitted: 'Mid-year submitted — waiting for acknowledgement',
  mid_year_done: 'Mid-year done — waiting for PMS',
  pms_self_review: 'Self-review due',
  pms_awaiting_appraiser: 'Waiting for appraiser',
  pms_awaiting_next_lvl: 'Waiting for next-level review',
  pms_awaiting_hra: 'Waiting for HRA to finalize',
  pms_finalized: 'Cycle complete',
};

function primaryCta(cycle: MyCycle): { href: string; label: string } | null {
  switch (cycle.state) {
    case 'kra_drafting':
    case 'kra_pending_approval':
      return { href: '/me/kra', label: 'Edit KRAs' };
    case 'mid_year_open':
    case 'mid_year_submitted':
      return { href: '/me/mid-year', label: 'Open mid-year check-in' };
    case 'pms_self_review':
      return {
        href: `/me/cycle/${cycle.id}/review`,
        label: 'Write self-review',
      };
    case 'pms_finalized':
      return {
        href: `/me/cycle/${cycle.id}/review`,
        label: 'View finalized review',
      };
    default:
      return null;
  }
}

function Me() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/api/v1/me') });
  const cycle = useQuery({
    queryKey: ['cycle', 'current'],
    queryFn: () => api<{ cycle: MyCycle | null }>('/api/v1/cycle/current'),
    enabled: !!me.data?.actor.staffId,
  });

  if (me.isLoading) return <div className="text-xs text-ink-2">Loading…</div>;

  const currentCycle = cycle.data?.cycle ?? null;
  const cta = currentCycle ? primaryCta(currentCycle) : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-2">Signed in</div>
        <div className="text-sm">{me.data?.actor.email}</div>
      </div>

      <div className="bg-surface border border-hairline rounded-md p-6">
        <div className="text-xs uppercase tracking-wider text-ink-2 mb-3">Current cycle</div>
        {!currentCycle ? (
          <div className="text-sm text-ink-2">
            No active cycle. Wait for HR to open your cycle — they can do this from{' '}
            <Link to="/hr/cycles" className="underline">
              HR &rsaquo; Cycles
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline gap-3">
              <div className="text-sm">FY {currentCycle.fy}</div>
              <div className="text-xs text-ink-2">
                {stateLabels[currentCycle.state] ?? currentCycle.state}
              </div>
            </div>
            {cta && (
              <a
                href={cta.href}
                className="inline-block bg-ink text-white rounded-sm px-3 py-1.5 text-sm"
              >
                {cta.label}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
