/**
 * TypeScript-only smoke test for TrajectoryBar.
 * Exercises exported types at compile time; no runtime assertions.
 */
import type { TrajectoryBarProps } from './TrajectoryBar';

const _withBoth: TrajectoryBarProps = {
  june: 3,
  current: 4,
  max: 5,
};

const _juneOnly: TrajectoryBarProps = {
  june: 2.5,
  current: null,
  max: 5,
};

const _noData: TrajectoryBarProps = {
  max: 5,
};

export type { TrajectoryBarProps };
void _withBoth;
void _juneOnly;
void _noData;
