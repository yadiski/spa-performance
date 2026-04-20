import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

function ErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen grid place-items-center bg-canvas p-8">
      <div className="bg-surface border border-hairline rounded-md p-6 max-w-xl w-full space-y-3">
        <h1 className="text-sm font-semibold text-ink">Something went wrong</h1>
        <pre className="text-xs text-ink-2 bg-canvas border border-hairline rounded-sm p-3 overflow-auto max-h-64 whitespace-pre-wrap">
          {String(error?.message ?? error)}
          {error?.stack ? `\n\n${error.stack}` : ''}
        </pre>
        <button
          type="button"
          onClick={reset}
          className="text-xs border border-hairline rounded-sm px-3 py-1.5 hover:bg-canvas"
        >
          Retry
        </button>
      </div>
    </main>
  );
}

function NotFoundFallback() {
  return (
    <main className="min-h-screen grid place-items-center bg-canvas p-8">
      <div className="bg-surface border border-hairline rounded-md p-6 text-sm text-ink">
        Page not found.{' '}
        <a href="/" className="text-ink underline">
          Go home
        </a>
      </div>
    </main>
  );
}

export const router = createRouter({
  routeTree,
  defaultErrorComponent: ErrorFallback,
  defaultNotFoundComponent: NotFoundFallback,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
