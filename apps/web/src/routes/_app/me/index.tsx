import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';

type MeResponse = { actor: { userId: string; staffId: string | null; roles: string[]; email: string } };
type MyCycle = { id: string; fy: number; state: string };

export const Route = createFileRoute('/_app/me/')({ component: Me });

function Me() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/api/v1/me') });
  const cycle = useQuery({
    queryKey: ['cycle', 'current'],
    queryFn: () => api<{ cycle: MyCycle | null }>('/api/v1/cycle/current'),
    enabled: !!me.data?.actor.staffId,
  });

  if (me.isLoading) return <div className="text-xs text-ink-2">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-2">Signed in</div>
        <div className="text-sm">{me.data?.actor.email}</div>
      </div>
      <div className="bg-surface border border-hairline rounded-md p-6">
        <div className="text-xs uppercase tracking-wider text-ink-2 mb-3">Current cycle</div>
        {!cycle.data?.cycle ? (
          <div className="text-sm text-ink-2">No active cycle. Wait for HR to open the KRA window.</div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">FY {cycle.data.cycle.fy}</div>
            <div className="text-xs text-ink-2">State: {cycle.data.cycle.state}</div>
            {cycle.data.cycle.state === 'kra_drafting' || cycle.data.cycle.state === 'kra_pending_approval' ? (
              <Link
                to="/me/kra"
                className="inline-block bg-ink text-white rounded-sm px-3 py-1.5 text-sm"
              >
                Edit KRAs
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
