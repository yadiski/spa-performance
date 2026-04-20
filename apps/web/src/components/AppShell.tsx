import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import { authClient } from '../auth/client';
import { NotificationBell } from './NotificationBell';
import { AiBudgetBar } from './ai/AiBudgetBar';

type Section = { to: string; label: string; roles?: string[] };

// Every role sees Me. Team is for anyone with reports. Department for department_head+.
// HR is HRA / hr_manager. Admin is it_admin only.
const sections: Section[] = [
  { to: '/me', label: 'Me' },
  { to: '/team', label: 'Team' },
  { to: '/department', label: 'Department', roles: ['department_head', 'hr_manager', 'hra'] },
  { to: '/hr', label: 'HR', roles: ['hr_manager', 'hra'] },
  { to: '/admin', label: 'Admin', roles: ['it_admin', 'hra'] },
];

interface MeResponse {
  actor: { roles: string[]; email: string; staffId: string | null };
}

export function AppShell({ children }: { children?: ReactNode }) {
  const qc = useQueryClient();
  const nav = useNavigate();

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/v1/me'),
    staleTime: 60_000,
  });

  const roles = meData?.actor?.roles ?? [];
  const email = meData?.actor?.email;
  const isHra = roles.includes('hra');

  const visible = sections.filter(
    (s) => !s.roles || s.roles.some((required) => roles.includes(required)),
  );

  async function onLogout() {
    await authClient.signOut();
    qc.clear();
    nav({ to: '/login' });
  }

  return (
    <div className="min-h-screen grid grid-cols-[220px_1fr]">
      <aside className="border-r border-hairline bg-surface p-4 flex flex-col">
        <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase mb-4">
          Performance
        </div>
        <nav className="space-y-1 flex-1">
          {visible.map((s) => (
            <Link
              key={s.to}
              to={s.to as unknown as '/me'}
              className="block text-sm text-ink hover:bg-canvas rounded-sm px-2 py-1.5"
              activeProps={{ className: 'bg-canvas' }}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="pt-4 mt-4 border-t border-hairline space-y-2">
          {email && (
            <div className="px-2 text-xs text-ink-2 break-words" title={email}>
              {email}
            </div>
          )}
          {roles.length > 0 && (
            <div className="px-2 flex flex-wrap gap-1">
              {roles.map((r) => (
                <span
                  key={r}
                  className="inline-block text-[10px] px-1.5 py-0.5 border border-hairline rounded-sm text-ink-2 bg-canvas"
                >
                  {r}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="block w-full text-left text-xs text-ink-2 hover:text-ink hover:bg-canvas rounded-sm px-2 py-1.5"
          >
            Sign out
          </button>
        </div>
      </aside>
      <section>
        <header className="h-14 border-b border-hairline bg-surface flex items-center justify-between px-6 text-xs text-ink-2">
          <span>Performance Management</span>
          <div className="flex items-center gap-4">
            {isHra && <AiBudgetBar />}
            <NotificationBell />
          </div>
        </header>
        <main className="p-8">{children ?? <Outlet />}</main>
      </section>
    </div>
  );
}
