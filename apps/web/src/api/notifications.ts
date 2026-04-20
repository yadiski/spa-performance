import { api } from './client';

export interface NotificationRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  targetType: string | null;
  targetId: string | null;
  readAt: string | null;
  createdAt: string;
}

function buildParams(params?: { unread?: boolean; limit?: number }): string {
  const p = new URLSearchParams();
  if (params?.unread) p.set('unread', 'true');
  if (params?.limit !== undefined) p.set('limit', String(params.limit));
  const str = p.toString();
  return str ? `?${str}` : '';
}

export const notificationsApi = {
  list: (params?: { unread?: boolean; limit?: number }) =>
    api<{ items: NotificationRow[] }>(`/api/v1/notifications${buildParams(params)}`),
  unreadCount: () => api<{ count: number }>('/api/v1/notifications/unread-count'),
  markRead: (id: string) =>
    api<{ ok: true; id: string }>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () =>
    api<{ ok: true; updated: number }>('/api/v1/notifications/read-all', { method: 'PATCH' }),
};
