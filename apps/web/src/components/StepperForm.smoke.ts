/**
 * Typecheck-only smoke test for StepperForm.
 * No runtime assertions — this file exists purely so `tsc --noEmit` verifies
 * that the component compiles with the expected props shape.
 *
 * RTL is not present in this project (no @testing-library/* deps), so we rely
 * on TypeScript rather than a test runner for compile-time verification.
 */
import type { ReactNode } from 'react';
import type { StepperFormProps, StepperStep } from './StepperForm';

// Verify StepperStep shape
const _step: StepperStep = {
  id: 'part-1',
  title: 'Part I: Results',
  description: 'Rate each KRA',
  content: null as unknown as ReactNode,
  canAdvance: () => true,
  optional: false,
};

// Verify StepperFormProps shape — full props
const _fullProps: StepperFormProps = {
  steps: [_step],
  onComplete: () => {},
  submitLabel: 'Submit',
  initialStep: 0,
};

// Verify StepperFormProps shape — minimal props (only required fields)
const _minimalProps: StepperFormProps = {
  steps: [_step],
  onComplete: async () => {},
};

// Verify async onComplete is accepted
const _asyncProps: StepperFormProps = {
  steps: [_step],
  onComplete: async () => {
    await Promise.resolve();
  },
};

// Suppress "unused variable" errors from tsc
export type { _step as StepChecked };
void _fullProps;
void _minimalProps;
void _asyncProps;
