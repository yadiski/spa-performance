import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { chartTheme } from './chart-theme';

export interface HistogramBucket {
  label: string;
  count: number;
}

export interface DistributionHistogramProps {
  buckets: HistogramBucket[];
  maxHeight?: number;
}

/**
 * Solid-fill bar chart, hairline grid, tabular count labels on top of each bar.
 * No animation, no gradients, no shadows.
 */
export function DistributionHistogram({ buckets, maxHeight = 180 }: DistributionHistogramProps) {
  if (buckets.length === 0) {
    return (
      <div className="flex items-center justify-center border border-hairline rounded-md bg-surface p-6 text-sm text-ink-2">
        No data
      </div>
    );
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <BarChart
      width={300}
      height={maxHeight}
      data={buckets}
      margin={{ top: 20, right: 8, bottom: 4, left: 8 }}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      <CartesianGrid
        vertical={false}
        stroke={chartTheme.gridStyle.stroke}
        strokeWidth={chartTheme.gridStyle.strokeWidth}
      />
      <XAxis
        dataKey="label"
        tick={{ fontSize: chartTheme.fontSize, fill: chartTheme.axisStyle.fill }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        domain={[0, maxCount]}
        allowDecimals={false}
        tick={{ fontSize: chartTheme.fontSize, fill: chartTheme.axisStyle.fill }}
        axisLine={false}
        tickLine={false}
        width={24}
      />
      <Bar
        dataKey="count"
        fill={chartTheme.barStyle.fill}
        radius={chartTheme.barStyle.radius}
        isAnimationActive={false}
        label={{
          position: 'top',
          fontSize: chartTheme.fontSize,
          fill: chartTheme.colors.secondary,
        }}
      />
    </BarChart>
  );
}
