import { useQuery } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import { NotificationBell } from './NotificationBell';
import { AiBudgetBar } from './ai/AiBudgetBar';

type Section = { to: string; label: string };

const sections: Section[] = [
  { to: '/me', label: 'Me' },
  { to: '/team', label: 'Team' },
  { to: '/department', label: 'Department' },
  { to: '/hr', label: 'HR' },
  { to: '/admin', label: 'Admin' },
];

interface MeResponse {
  actor: { roles: string[] };
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/v1/me'),
    staleTime: 60_000,
  });

  const isHra = meData?.actor?.roles?.includes('hra') ?? false;

  return (
    <div className="min-h-screen grid grid-cols-[220px_1fr]">
      <aside className="border-r border-hairline bg-surface p-4 space-y-2">
        <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase mb-4">
          Performance
        </div>
        {sections.map((s) => (
          <Link
            key={s.to}
            to={s.to as unknown as '/me'}
            className="block text-sm text-ink hover:bg-canvas rounded-sm px-2 py-1.5"
            activeProps={{ className: 'bg-canvas' }}
          >
            {s.label}
          </Link>
        ))}
      </aside>
      <section>
        <header className="h-14 border-b border-hairline bg-surface flex items-center justify-between px-6 text-xs text-ink-2">
          <span>FY 2026 · KRA drafting</span>
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
