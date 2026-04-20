export interface TrajectoryBarProps {
  june?: number | null;
  current?: number | null;
  /** Upper bound of the scale. Typically 5 for PMS ratings. */
  max: number;
}

/** Horizontal trajectory bar showing June vs current rating on a 1-max scale. */
export function TrajectoryBar({ june, current, max }: TrajectoryBarProps) {
  const ticks = Array.from({ length: max }, (_, i) => i + 1);

  const toPercent = (v: number) => ((v - 1) / (max - 1)) * 100;

  return (
    <div className="w-full space-y-1">
      {/* Track */}
      <div className="relative h-2 bg-canvas border border-hairline rounded-none">
        {/* June marker */}
        {june != null && june >= 1 && june <= max && (
          <div
            className="absolute top-0 h-full w-0.5 bg-ink-2"
            style={{ left: `${toPercent(june)}%` }}
            title={`June: ${june}`}
          />
        )}
        {/* Current marker */}
        {current != null && current >= 1 && current <= max && (
          <div
            className="absolute top-0 h-full w-1 bg-ink"
            style={{ left: `${toPercent(current)}%` }}
            title={`Now: ${current}`}
          />
        )}
      </div>

      {/* Tick labels */}
      <div
        className="flex justify-between text-xs text-ink-2"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-xs text-ink-2">
        {june != null && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-0.5 bg-ink-2" />
            June ({june.toFixed(1)})
          </span>
        )}
        {current != null && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-0.5 bg-ink" />
            Now ({current.toFixed(1)})
          </span>
        )}
        {june == null && current == null && <span className="text-ink-2">No data</span>}
      </div>
    </div>
  );
}
