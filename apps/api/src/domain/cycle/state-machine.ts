import { CycleState } from '@spa/shared';

export type Transition = {
  from: CycleState;
  to: CycleState;
  action: string;
  roles: ReadonlyArray<'staff' | 'appraiser' | 'next_level' | 'hra'>;
};

export const transitions: Transition[] = [
  { from: CycleState.KraDrafting,         to: CycleState.KraPendingApproval,   action: 'submit_kra',              roles: ['staff'] },
  { from: CycleState.KraPendingApproval,  to: CycleState.KraApproved,          action: 'approve_kra',             roles: ['appraiser'] },
  { from: CycleState.KraPendingApproval,  to: CycleState.KraDrafting,          action: 'reject_kra',              roles: ['appraiser'] },
  { from: CycleState.KraApproved,         to: CycleState.MidYearOpen,          action: 'open_mid_year',           roles: ['hra'] },
  { from: CycleState.MidYearOpen,         to: CycleState.MidYearSubmitted,     action: 'submit_mid_year',         roles: ['staff'] },
  { from: CycleState.MidYearSubmitted,    to: CycleState.MidYearDone,          action: 'ack_mid_year',            roles: ['appraiser'] },
  { from: CycleState.MidYearDone,         to: CycleState.PmsSelfReview,        action: 'open_pms',                roles: ['hra'] },
  { from: CycleState.PmsSelfReview,       to: CycleState.PmsAwaitingAppraiser, action: 'submit_self_review',      roles: ['staff'] },
  { from: CycleState.PmsAwaitingAppraiser, to: CycleState.PmsSelfReview,       action: 'return_to_appraisee',     roles: ['appraiser'] },
  { from: CycleState.PmsAwaitingAppraiser, to: CycleState.PmsAwaitingNextLevel, action: 'submit_appraiser_rating', roles: ['appraiser'] },
  { from: CycleState.PmsAwaitingNextLevel, to: CycleState.PmsAwaitingAppraiser, action: 'return_to_appraiser',    roles: ['next_level'] },
  { from: CycleState.PmsAwaitingNextLevel, to: CycleState.PmsAwaitingHra,      action: 'submit_next_level',       roles: ['next_level'] },
  { from: CycleState.PmsAwaitingHra,      to: CycleState.PmsFinalized,         action: 'finalize',                roles: ['hra'] },
];

export type ValidateInput = { from: CycleState; action: string; actorRoles: string[] };
export type ValidateResult = { ok: true; to: CycleState } | { ok: false; reason: string };

export function validate(input: ValidateInput): ValidateResult {
  const t = transitions.find((t) => t.from === input.from && t.action === input.action);
  if (!t) return { ok: false, reason: `no transition from ${input.from} via ${input.action}` };
  const allowed = input.actorRoles.some((r) => t.roles.includes(r as Transition['roles'][number]));
  if (!allowed) return { ok: false, reason: `role not authorized for ${input.action}` };
  return { ok: true, to: t.to };
}
