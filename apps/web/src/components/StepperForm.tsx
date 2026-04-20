import { type KeyboardEvent, type ReactNode, useCallback, useRef, useState } from 'react';

export interface StepperStep {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  canAdvance?: () => boolean;
  optional?: boolean;
}

export interface StepperFormProps {
  steps: StepperStep[];
  onComplete: () => void | Promise<void>;
  submitLabel?: string;
  initialStep?: number;
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function StepperForm({
  steps,
  onComplete,
  submitLabel = 'Submit',
  initialStep = 0,
}: StepperFormProps) {
  const [current, setCurrent] = useState(() =>
    Math.max(0, Math.min(initialStep, steps.length - 1)),
  );
  const [submitting, setSubmitting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const isLast = current === steps.length - 1;
  const currentStep = steps[current];
  const canGoNext = currentStep?.canAdvance ? currentStep.canAdvance() : true;

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= steps.length) return;
      // Save and restore scroll position on the content panel
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
      setCurrent(index);
    },
    [steps.length],
  );

  const handleNext = useCallback(async () => {
    if (!canGoNext) return;
    if (isLast) {
      setSubmitting(true);
      try {
        await onComplete();
      } finally {
        setSubmitting(false);
      }
    } else {
      goTo(current + 1);
    }
  }, [canGoNext, isLast, onComplete, goTo, current]);

  const handleBack = useCallback(() => {
    if (current > 0) goTo(current - 1);
  }, [current, goTo]);

  const handleIndicatorKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, index: number) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = index + 1;
        if (next < steps.length && next <= current) {
          goTo(next);
          const el = document.getElementById(`stepper-step-${steps[next]?.id}`);
          el?.focus();
        }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = index - 1;
        if (prev >= 0) {
          goTo(prev);
          const el = document.getElementById(`stepper-step-${steps[prev]?.id}`);
          el?.focus();
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (index <= current) goTo(index);
      }
    },
    [steps, current, goTo],
  );

  return (
    <div className="flex min-h-0 h-full">
      {/* Left: vertical step indicator */}
      <nav
        aria-label="Form steps"
        className="w-56 shrink-0 border-r border-hairline bg-surface py-6 px-4 space-y-1"
      >
        {steps.map((step, index) => {
          const isCompleted = index < current;
          const isCurrent = index === current;
          // Users can click back to any completed step or the current step
          const isClickable = index <= current;

          return (
            <button
              key={step.id}
              id={`stepper-step-${step.id}`}
              type="button"
              disabled={!isClickable}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => goTo(index)}
              onKeyDown={(e) => handleIndicatorKeyDown(e, index)}
              className={[
                'w-full flex items-start gap-3 rounded-sm px-2 py-2.5 text-left transition-colors',
                isClickable
                  ? 'cursor-pointer hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30'
                  : 'cursor-default opacity-50',
                isCurrent ? 'bg-canvas' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {/* Pill number or check */}
              <span
                className={[
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  isCurrent
                    ? 'bg-ink text-white'
                    : isCompleted
                      ? 'bg-ink/10 text-ink'
                      : 'bg-track text-ink-3',
                ].join(' ')}
                aria-hidden="true"
              >
                {isCompleted ? <CheckIcon /> : index + 1}
              </span>

              {/* Title + optional description */}
              <div className="min-w-0">
                <div
                  className={[
                    'text-sm leading-snug',
                    isCurrent ? 'font-medium text-ink' : isCompleted ? 'text-ink' : 'text-ink-3',
                  ].join(' ')}
                >
                  {step.title}
                </div>
                {step.description && (
                  <div className="mt-0.5 text-xs text-ink-2 leading-snug">{step.description}</div>
                )}
                {step.optional && <div className="mt-0.5 text-xs text-ink-3 italic">Optional</div>}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Right: content + footer */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Scrollable content area */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-8">
          {currentStep?.content}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-hairline bg-surface px-8 py-4 flex items-center justify-between">
          {/* Step counter */}
          <span className="text-xs text-ink-2">
            Step {current + 1} of {steps.length}
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              disabled={current === 0 || submitting}
              className="rounded-sm px-3 py-1.5 text-sm border border-hairline text-ink hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Back
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={!canGoNext || submitting}
              className="rounded-sm px-3 py-1.5 text-sm bg-ink text-white hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting…' : isLast ? submitLabel : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
