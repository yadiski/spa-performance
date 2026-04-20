import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { type StaffSearchHit, searchApi } from '../../api/search';

export interface StaffSearchComboboxProps {
  onSelect: (staff: StaffSearchHit) => void;
  placeholder?: string;
  /** Client-side hint for department-scoped use — appended as filter param in future. */
  scope?: 'dept';
}

export function StaffSearchCombobox({
  onSelect,
  placeholder = 'Search staff…',
  scope: _scope,
}: StaffSearchComboboxProps) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Debounce: 300 ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(inputValue);
      setActiveIndex(-1);
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', 'staff', debouncedQ],
    queryFn: () => searchApi.staff(debouncedQ, 20, 0),
    enabled: open,
    staleTime: 10_000,
  });

  const items = data?.items ?? [];

  // Open dropdown when typing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setOpen(true);
  };

  const handleSelect = (staff: StaffSearchHit) => {
    onSelect(staff);
    setInputValue(staff.name);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        return;
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && items[activeIndex]) {
          handleSelect(items[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const li = listRef.current.children[activeIndex] as HTMLElement | undefined;
      li?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  return (
    <div className="relative w-full">
      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="staff-search-listbox"
        aria-activedescendant={activeIndex >= 0 ? `staff-search-item-${activeIndex}` : undefined}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Close only if focus leaves entirely
          if (
            !e.relatedTarget ||
            !e.currentTarget.closest('[data-staff-search]')?.contains(e.relatedTarget)
          ) {
            setTimeout(() => setOpen(false), 150);
          }
        }}
        placeholder={placeholder}
        className="w-full text-sm border border-hairline rounded-sm px-3 py-1.5 bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
        autoComplete="off"
      />

      {/* Dropdown */}
      {open && (
        <div
          data-staff-search
          className="absolute z-50 mt-1 w-full bg-surface border border-hairline rounded-md shadow-md max-h-64 overflow-hidden"
        >
          {isFetching && (
            <div className="px-3 py-2 text-xs text-ink-2 animate-pulse">Searching…</div>
          )}

          {!isFetching && items.length === 0 && (
            <div className="px-3 py-3 text-sm text-ink-2">No matches</div>
          )}

          {!isFetching && items.length > 0 && (
            <ul
              ref={listRef}
              id="staff-search-listbox"
              aria-label="Staff search results"
              className="overflow-y-auto max-h-64"
            >
              {items.map((hit, idx) => (
                <li
                  key={hit.id}
                  id={`staff-search-item-${idx}`}
                  aria-selected={idx === activeIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(hit);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={[
                    'px-3 py-2 cursor-pointer',
                    idx === activeIndex ? 'bg-canvas' : 'hover:bg-canvas',
                  ].join(' ')}
                >
                  {/* Primary line */}
                  <div className="text-sm text-ink leading-snug">
                    {hit.name} <span className="text-ink-2">— {hit.employeeNo}</span>{' '}
                    <span className="text-ink-2">· {hit.departmentName}</span>
                  </div>
                  {/* Secondary line */}
                  <div className="text-xs text-ink-2 leading-snug mt-0.5">{hit.designation}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
