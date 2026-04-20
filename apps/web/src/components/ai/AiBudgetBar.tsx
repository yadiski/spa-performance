import { useQuery } from '@tanstack/react-query';
import { aiApi } from '../../api/ai';

/**
 * AiBudgetBar — shows AI daily budget usage in the HR admin header.
 * Hidden below 50%. Warning at 50–99%. Hard stop at 100%.
 */
export function AiBudgetBar() {
  const { data } = useQuery({
    queryKey: ['ai', 'usage-today'],
    queryFn: aiApi.usageToday,
    refetchInterval: 300_000, // 5 minutes
  });

  if (!data || data.usagePct < 50) return null;

  if (data.usagePct >= 100) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-red-600/10 border border-red-600/30 rounded-sm text-xs text-red-700 font-medium">
        {/* Inline stop icon */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle cx="6" cy="6" r="5.5" stroke="currentColor" strokeWidth="1" />
          <path
            d="M4 4l4 4M8 4l-4 4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        AI budget reached — resumes tomorrow
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-ink-2">
      <span className="shrink-0">AI: {data.usagePct}% of daily budget</span>
      <div className="w-20 h-1.5 bg-canvas rounded-full overflow-hidden border border-hairline">
        <div
          className="h-full bg-ink-2 rounded-full transition-all"
          style={{ width: `${data.usagePct}%` }}
        />
      </div>
    </div>
  );
}
