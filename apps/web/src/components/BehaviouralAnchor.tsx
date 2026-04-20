import { useCallback, useRef } from 'react';

export interface BehaviouralAnchorProps {
  dimension: {
    code: string;
    title: string;
    description: string;
    anchors: string[]; // length 5, 1→5
  };
  value: {
    rating: 1 | 2 | 3 | 4 | 5 | null;
    anchorText: string | null;
  };
  onChange: (next: { rating: 1 | 2 | 3 | 4 | 5; anchorText: string }) => void;
  disabled?: boolean;
}

const RATINGS = [1, 2, 3, 4, 5] as const;

export function BehaviouralAnchor({
  dimension,
  value,
  onChange,
  disabled = false,
}: BehaviouralAnchorProps) {
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([null, null, null, null, null]);

  const handleSelect = useCallback(
    (rating: 1 | 2 | 3 | 4 | 5) => {
      if (disabled) return;
      // §4.3 — capture anchor text at the moment of selection (immutable snapshot)
      const anchorText = dimension.anchors[rating - 1] ?? '';
      onChange({ rating, anchorText });
    },
    [disabled, dimension.anchors, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (disabled) return;

      let nextIndex: number | null = null;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = (index + 1) % 5;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = (index + 4) % 5;
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect(RATINGS[index] as 1 | 2 | 3 | 4 | 5);
        return;
      }

      if (nextIndex !== null) {
        cardRefs.current[nextIndex]?.focus();
      }
    },
    [disabled, handleSelect],
  );

  return (
    <div className="space-y-3">
      {/* Dimension header */}
      <div>
        <h3 className="text-sm font-semibold text-ink">{dimension.title}</h3>
        <p className="text-xs text-ink-2 mt-0.5">{dimension.description}</p>
      </div>

      {/* Anchor cards */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
        {RATINGS.map((rating, index) => {
          const anchorText = dimension.anchors[index] ?? '';
          const isSelected = value.rating === rating;

          return (
            <button
              key={rating}
              type="button"
              ref={(el) => {
                cardRefs.current[index] = el;
              }}
              onClick={() => handleSelect(rating)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={`Rating ${rating}: ${anchorText}`}
              className={[
                'text-left rounded-md border p-3 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30',
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-canvas',
                isSelected
                  ? 'border-ink bg-canvas font-medium text-ink'
                  : 'border-hairline bg-surface text-ink-2',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="block font-semibold text-sm mb-1 text-ink">{rating}</span>
              <span className="leading-snug">{anchorText}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
