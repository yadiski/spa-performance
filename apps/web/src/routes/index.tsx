import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => (
    <main className="min-h-screen grid place-items-center">
      <div className="text-ink text-sm">Performance Management — scaffolding ready.</div>
    </main>
  ),
});
