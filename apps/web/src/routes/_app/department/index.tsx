import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/department/')({
  component: () => <div className="text-ink-2 text-sm">Coming in phase 2.</div>,
});
