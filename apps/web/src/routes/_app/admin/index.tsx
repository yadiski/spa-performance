import { Link, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/admin/')({ component: AdminHome });

type Card = { to: string; title: string; description: string };

const cards: Card[] = [
  {
    to: '/admin/audit',
    title: 'Audit chain verify',
    description: 'Confirm the hash chain of the audit log is intact across a date range.',
  },
  {
    to: '/admin/access-review',
    title: 'Access review',
    description: 'Approve, revoke, or defer the roles assigned to each active user.',
  },
];

function AdminHome() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Administration</h1>
        <p className="text-sm text-ink-2 mt-1">
          Operational tools for IT admins and compliance reviewers.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map((c) => (
          <Link
            key={c.to}
            to={c.to as unknown as '/admin/audit'}
            className="block bg-surface border border-hairline rounded-md p-4 hover:bg-canvas"
          >
            <div className="text-sm font-medium text-ink">{c.title}</div>
            <div className="text-xs text-ink-2 mt-1">{c.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
