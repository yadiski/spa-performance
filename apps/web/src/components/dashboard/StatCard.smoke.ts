/**
 * TypeScript-only smoke test for StatCard.
 * Exercises exported types at compile time; no runtime assertions.
 */
import type { StatCardProps } from './StatCard';

const _minimal: StatCardProps = {
  label: 'Total cycles',
  value: 42,
};

const _withTrend: StatCardProps = {
  label: 'Avg score',
  value: '3.85',
  helpText: 'Current financial year',
  trend: { direction: 'up', pct: 5 },
};

const _flat: StatCardProps = {
  label: 'In progress',
  value: 7,
  trend: { direction: 'flat' },
};

const _down: StatCardProps = {
  label: 'Completion',
  value: '65%',
  trend: { direction: 'down', pct: 3 },
};

export type { StatCardProps };
void _minimal;
void _withTrend;
void _flat;
void _down;
