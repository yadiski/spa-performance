import { describe, expect, it } from 'bun:test';
import { validate } from '../src/domain/cycle/state-machine';
import { CycleState } from '@spa/shared';

describe('cycle state machine', () => {
  it('allows staff submit_kra from kra_drafting', () => {
    const r = validate({ from: CycleState.KraDrafting, action: 'submit_kra', actorRoles: ['staff'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe(CycleState.KraPendingApproval);
  });

  it('forbids staff from approve_kra', () => {
    const r = validate({ from: CycleState.KraPendingApproval, action: 'approve_kra', actorRoles: ['staff'] });
    expect(r.ok).toBe(false);
  });

  it('allows appraiser reject_kra; returns to kra_drafting', () => {
    const r = validate({ from: CycleState.KraPendingApproval, action: 'reject_kra', actorRoles: ['appraiser'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe(CycleState.KraDrafting);
  });

  it('rejects unknown actions', () => {
    const r = validate({ from: CycleState.KraDrafting, action: 'teleport', actorRoles: ['hra'] });
    expect(r.ok).toBe(false);
  });
});
