export interface StatCardProps {
  label: string;
  value: string | number;
  helpText?: string;
  trend?: {
    direction: 'up' | 'down' | 'flat';
    pct?: number;
  };
}

const trendIcon = {
  up: '↑',
  down: '↓',
  flat: '→',
} as const;

const trendColor = {
  up: 'text-green-600',
  down: 'text-neg',
  flat: 'text-ink-2',
} as const;

export function StatCard({ label, value, helpText, trend }: StatCardProps) {
  return (
    <div className="bg-surface border border-hairline rounded-md p-4 space-y-1">
      {/* Label */}
      <div className="text-xs text-ink-2 uppercase tracking-wider">{label}</div>

      {/* Divider */}
      <div className="border-t border-hairline" />

      {/* Value — tabular numerals */}
      <div
        className="text-2xl font-semibold text-ink leading-none"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>

      {/* Trend */}
      {trend && (
        <div className={['text-xs flex items-center gap-1', trendColor[trend.direction]].join(' ')}>
          <span>{trendIcon[trend.direction]}</span>
          {trend.pct != null && <span>{trend.pct}%</span>}
        </div>
      )}

      {/* Help text */}
      {helpText && <div className="text-xs text-ink-2">{helpText}</div>}
    </div>
  );
}
