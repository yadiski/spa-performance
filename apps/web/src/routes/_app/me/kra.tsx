import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/me/kra')({
  component: () => <div className="text-ink-2 text-sm">KRA form — coming in task 19.</div>,
});
