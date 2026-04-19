import { Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';

type Section = { to: string; label: string };

const sections: Section[] = [
  { to: '/me', label: 'Me' },
  { to: '/team', label: 'Team' },
  { to: '/department', label: 'Department' },
  { to: '/hr', label: 'HR' },
  { to: '/admin', label: 'Admin' },
];

export function AppShell({ children }: { children?: ReactNode }) {
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
        <header className="h-14 border-b border-hairline bg-surface flex items-center px-6 text-xs text-ink-2">
          FY 2026 · KRA drafting
        </header>
        <main className="p-8">{children ?? <Outlet />}</main>
      </section>
    </div>
  );
}
