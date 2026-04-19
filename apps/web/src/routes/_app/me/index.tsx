import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/me/')({
  component: () => <div className="text-ink-2 text-sm">Coming in phase 2.</div>,
});
