/**
 * TypeScript-only smoke test for CalibrationMatrix.
 */
import type { CalibrationMatrixProps } from './CalibrationMatrix';

const _basic: CalibrationMatrixProps = {
  cells: [
    { staffKey: 'st-1', staffName: 'Alice Tan', rating: 4.2, isOutlier: false },
    { staffKey: 'st-2', staffName: 'Bob Lim', rating: 1.8, isOutlier: true },
    { staffKey: 'st-3', staffName: 'Carol Ng', rating: 3.5, isOutlier: false },
  ],
  gridCols: 3,
};

const _empty: CalibrationMatrixProps = {
  cells: [],
  gridCols: 4,
};

export type { CalibrationMatrixProps };
void _basic;
void _empty;
