import { describe, expect, it } from 'bun:test';
import { kraCreateBatch, CycleState, Role } from '../src/index';

describe('kraCreateBatch', () => {
  const validKra = {
    perspective: 'financial' as const,
    description: 'Deliver systems on time and within cost envelope.',
    weightPct: 25,
    measurement: 'Milestone tracking + vendor CRs.',
    target: '100% completion',
    order: 0,
    rubric1to5: ['r1', 'r2', 'r3', 'r4', 'r5'],
  };

  it('accepts 4 KRAs totalling 100%', () => {
    const result = kraCreateBatch.safeParse({
      cycleId: '11111111-1111-1111-1111-111111111111',
      kras: [
        { ...validKra, weightPct: 25 },
        { ...validKra, weightPct: 25, order: 1 },
        { ...validKra, weightPct: 25, order: 2 },
        { ...validKra, weightPct: 25, order: 3 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects weights that do not total 100%', () => {
    const result = kraCreateBatch.safeParse({
      cycleId: '11111111-1111-1111-1111-111111111111',
      kras: [
        { ...validKra, weightPct: 50 },
        { ...validKra, weightPct: 40, order: 1 },
        { ...validKra, weightPct: 5, order: 2 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects fewer than 3 KRAs', () => {
    const result = kraCreateBatch.safeParse({
      cycleId: '11111111-1111-1111-1111-111111111111',
      kras: [{ ...validKra, weightPct: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it('exposes enum values', () => {
    expect(Role.Hra).toBe('hra');
    expect(CycleState.KraDrafting).toBe('kra_drafting');
  });
});
