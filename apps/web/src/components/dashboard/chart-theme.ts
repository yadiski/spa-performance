/**
 * Shared recharts theme for all dashboard charts.
 * Enterprise-formal: hairline grid, ink primary, no gradients, no shadows,
 * no rounded corners, tabular numerals.
 */

export const chartTheme = {
  colors: {
    primary: '#1a1a1a', // ink — primary series fill
    secondary: '#6b7280', // ink-2 — secondary / muted
    grid: '#e5e7eb', // hairline color
    axis: '#9ca3af', // axis labels
    background: '#ffffff', // surface
    accent: '#374151', // for markers / dots
  },
  strokeWidth: 1,
  fontSize: 11,
  fontFamily: 'var(--font-sans, system-ui, sans-serif)',
  gridStyle: {
    stroke: '#e5e7eb', // hairline
    strokeDasharray: 'none',
    strokeWidth: 1,
  },
  axisStyle: {
    fontSize: 11,
    fill: '#9ca3af',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    // tabular numerals via CSS feature string (recharts doesn't support fontVariantNumeric natively)
  },
  barStyle: {
    fill: '#1a1a1a',
    radius: 0, // no rounded corners
  },
} as const;
