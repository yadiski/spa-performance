/**
 * TypeScript-only smoke test for DistributionHistogram.
 */
import type { DistributionHistogramProps } from './DistributionHistogram';

const _basic: DistributionHistogramProps = {
  buckets: [
    { label: '1-2', count: 2 },
    { label: '2-3', count: 5 },
    { label: '3-4', count: 12 },
    { label: '4-5', count: 8 },
  ],
};

const _empty: DistributionHistogramProps = {
  buckets: [],
  maxHeight: 200,
};

export type { DistributionHistogramProps };
void _basic;
void _empty;
