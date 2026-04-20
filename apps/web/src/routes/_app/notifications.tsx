import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type NotificationRow, notificationsApi } from '../../api/notifications';

export const Route = createFileRoute('/_app/notifications')({ component: NotificationsPage });

const KIND_LABELS: Record<string, string> = {
  'mid_year.opened': 'Mid-year check-in open',
  'mid_year.submitted': 'Mid-year update submitted',
  'mid_year.acked': 'Mid-year update acknowledged',
  'pms.self_review.submitted': 'Self-review submitted',
  'pms.appraiser.submitted': 'Appraiser rating submitted',
  'pms.returned_to_appraisee': 'Returned for revision',
  'pms.returned_to_appraiser': 'Returned to appraiser',
  'pms.next_level.submitted': 'Sent for HR finalization',
  'pms.finalized': 'Performance review finalized',
  'pms.reopened': 'Review reopened',
  'pms.pdf.ready': 'PDF ready to download',
  'export.ready': 'Export ready to download',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function targetUrl(row: NotificationRow): string | null {
  if (!row.targetType || !row.targetId) return null;
  if (row.targetType === 'cycle') return `/me/cycle/${row.targetId}`;
  if (row.targetType === 'pms') return `/me/cycle/${row.targetId}`;
  if (row.targetType === 'mid_year') return '/me/mid-year';
  return null;
}

function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list({ limit: 50 }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const items = data?.items ?? [];

  async function handleRowClick(row: NotificationRow) {
    if (!row.readAt) {
      await markRead.mutateAsync(row.id);
    }
    const url = targetUrl(row);
    if (url) {
      navigate({ to: url as '/' });
    }
  }

  if (isLoading) {
    return <div className="text-xs text-ink-2">Loading…</div>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Notifications</h1>
        {items.some((i) => !i.readAt) && (
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="text-xs text-ink-2 hover:text-ink border border-hairline rounded-sm px-2 py-1"
          >
            Mark all read
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-ink-2">No notifications yet.</div>
      ) : (
        <ul className="space-y-1">
          {items.map((row) => {
            const url = targetUrl(row);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => handleRowClick(row)}
                  className="w-full text-left flex items-start gap-3 bg-surface border border-hairline rounded-md px-4 py-3 hover:bg-canvas transition-colors"
                >
                  <span
                    className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ${row.readAt ? 'bg-transparent border border-hairline' : 'bg-ink'}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm">{kindLabel(row.kind)}</span>
                    <span className="block text-xs text-ink-2 mt-0.5">
                      {relativeTime(row.createdAt)}
                      {url ? ' · tap to view' : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
