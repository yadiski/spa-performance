export const Role = {
  Staff: 'staff',
  Appraiser: 'appraiser',
  NextLevel: 'next_level',
  DepartmentHead: 'department_head',
  HrManager: 'hr_manager',
  Hra: 'hra',
  ItAdmin: 'it_admin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const KraPerspective = {
  Financial: 'financial',
  Customer: 'customer',
  InternalProcess: 'internal_process',
  LearningGrowth: 'learning_growth',
} as const;
export type KraPerspective = (typeof KraPerspective)[keyof typeof KraPerspective];

export const CycleState = {
  KraDrafting: 'kra_drafting',
  KraPendingApproval: 'kra_pending_approval',
  KraApproved: 'kra_approved',
  MidYearOpen: 'mid_year_open',
  MidYearSubmitted: 'mid_year_submitted',
  MidYearDone: 'mid_year_done',
  PmsSelfReview: 'pms_self_review',
  PmsAwaitingAppraiser: 'pms_awaiting_appraiser',
  PmsAwaitingNextLevel: 'pms_awaiting_next_lvl',
  PmsAwaitingHra: 'pms_awaiting_hra',
  PmsFinalized: 'pms_finalized',
} as const;
export type CycleState = (typeof CycleState)[keyof typeof CycleState];
