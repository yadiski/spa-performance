export interface CalibrationCell {
  staffKey: string;
  staffName: string;
  rating: number;
  isOutlier: boolean;
}

export interface CalibrationMatrixProps {
  cells: CalibrationCell[];
  gridCols: number;
}

/**
 * Visual grid of staff cells for calibration review.
 * Outliers get a subdued red-ish tint. Hover shows staff name.
 * No animation.
 */
export function CalibrationMatrix({ cells, gridCols }: CalibrationMatrixProps) {
  if (cells.length === 0) {
    return (
      <div className="text-sm text-ink-2 border border-hairline rounded-md p-4 bg-surface">
        No staff in this cohort.
      </div>
    );
  }

  const colClass = gridCols <= 3 ? `grid-cols-${gridCols}` : 'grid-cols-4';

  return (
    <div
      className={`grid gap-2 ${colClass}`}
      style={{ gridTemplateColumns: `repeat(${Math.min(gridCols, 8)}, minmax(0, 1fr))` }}
    >
      {cells.map((cell) => (
        <div
          key={cell.staffKey}
          title={cell.staffName}
          className={[
            'rounded-sm border p-2 text-center cursor-default select-none transition-colors',
            cell.isOutlier
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-hairline bg-surface text-ink',
          ].join(' ')}
        >
          <div
            className="text-lg font-semibold leading-none"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {cell.rating.toFixed(1)}
          </div>
          <div className="text-xs mt-0.5 truncate text-ink-2" title={cell.staffName}>
            {cell.staffName.split(' ')[0]}
          </div>
        </div>
      ))}
    </div>
  );
}
