/**
 * TypeScript-only smoke test for BehaviouralAnchor.
 * No RTL is installed in apps/web — this file exercises the exported types
 * at compile time only. bun test picks it up but it has no runtime assertions,
 * so it contributes 0 test cases and cannot regress the suite.
 */

import type { BehaviouralAnchorProps } from './BehaviouralAnchor';

// ---------------------------------------------------------------------------
// Shape: full valid props
// ---------------------------------------------------------------------------
const _validFull: BehaviouralAnchorProps = {
  dimension: {
    code: 'communication_skills',
    title: 'Communication Skills',
    description: 'Ability to communicate both orally and in writing.',
    anchors: ['anchor1', 'anchor2', 'anchor3', 'anchor4', 'anchor5'],
  },
  value: { rating: 3, anchorText: 'anchor3' },
  onChange: (_next) => {},
  disabled: false,
};

// ---------------------------------------------------------------------------
// Shape: null state (no selection yet)
// ---------------------------------------------------------------------------
const _nullState: BehaviouralAnchorProps = {
  dimension: {
    code: 'reliability',
    title: 'Reliability',
    description: 'Reliability in execution of assigned tasks.',
    anchors: ['a1', 'a2', 'a3', 'a4', 'a5'],
  },
  value: { rating: null, anchorText: null },
  onChange: (_next) => {},
};

// ---------------------------------------------------------------------------
// onChange callback: verify the emitted payload has the correct shape
// ---------------------------------------------------------------------------
const _onChangeShape: BehaviouralAnchorProps['onChange'] = (next) => {
  // `next.rating` must be 1|2|3|4|5 (narrowed union, not number)
  const r: 1 | 2 | 3 | 4 | 5 = next.rating;
  // `next.anchorText` must be string
  const t: string = next.anchorText;
  void r;
  void t;
};

// ---------------------------------------------------------------------------
// Ensure `disabled` is optional (no default required at call site)
// ---------------------------------------------------------------------------
const _noDisabled: BehaviouralAnchorProps = {
  dimension: {
    code: 'adaptability_changes',
    title: 'Adaptability to Changes',
    description: 'Ability to cope with new changes.',
    anchors: ['b1', 'b2', 'b3', 'b4', 'b5'],
  },
  value: { rating: 1, anchorText: 'b1' },
  onChange: () => {},
};

// Keep the module from being tree-shaken by tsc's --isolatedModules check.
export type { BehaviouralAnchorProps };
void _validFull;
void _nullState;
void _onChangeShape;
void _noDisabled;
