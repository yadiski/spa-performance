import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { AiTag } from './AiTag';

interface AiPanelProps<T> {
  title: string;
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  children: (output: T) => ReactNode;
  onRegenerate?: () => void;
}

function errorMessage(err: unknown): ReactNode {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ai_budget_exhausted')) {
    return <p className="text-sm text-ink-2">Daily AI budget reached. Resets tomorrow.</p>;
  }
  if (msg.includes('ai_schema_failed')) {
    return <p className="text-sm text-ink-2">AI output could not be parsed. Try again later.</p>;
  }
  if (msg.includes('ai_rate_limited')) {
    return <p className="text-sm text-ink-2">Please wait a moment before retrying.</p>;
  }
  return <p className="text-sm text-neg">Something went wrong. Try again.</p>;
}

// biome-ignore lint/suspicious/noExplicitAny: generic component signature
export function AiPanel<T = any>({
  title,
  queryKey,
  queryFn,
  children,
  onRegenerate,
}: AiPanelProps<T>) {
  const [dismissed, setDismissed] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn,
  });

  if (dismissed) return null;

  return (
    <div className="bg-surface border border-hairline rounded-md p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{title}</span>
          <AiTag />
        </div>
        <div className="flex items-center gap-2">
          {onRegenerate && (
            <button
              type="button"
              onClick={() => {
                onRegenerate();
                refetch();
              }}
              className="text-xs text-ink-2 hover:text-ink border border-hairline rounded-sm px-2 py-0.5 hover:bg-canvas transition-colors"
            >
              Regenerate
            </button>
          )}
          {!onRegenerate && (
            <button
              type="button"
              onClick={() => refetch()}
              className="text-xs text-ink-2 hover:text-ink border border-hairline rounded-sm px-2 py-0.5 hover:bg-canvas transition-colors"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss AI panel"
            className="text-xs text-ink-2 hover:text-ink px-1"
          >
            {/* Inline X icon */}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M1 1l10 10M11 1L1 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-canvas rounded-sm w-3/4" />
          <div className="h-3 bg-canvas rounded-sm w-1/2" />
          <div className="h-3 bg-canvas rounded-sm w-2/3" />
        </div>
      )}

      {isError && (
        <div className="space-y-2">
          {errorMessage(error)}
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-ink-2 hover:text-ink underline"
          >
            Try again
          </button>
        </div>
      )}

      {data !== undefined && !isLoading && !isError && children(data)}
    </div>
  );
}
