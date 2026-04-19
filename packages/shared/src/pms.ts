import { z } from 'zod';

export const PmsCommentRole = {
  Appraiser: 'appraiser',
  Appraisee: 'appraisee',
  NextLevel: 'next_level',
} as const;
export type PmsCommentRole = (typeof PmsCommentRole)[keyof typeof PmsCommentRole];

export const PotentialWindow = {
  Now: 'now',
  OneToTwoYears: '1-2_years',
  AfterTwoYears: 'after_2_years',
  NotReady: 'not_ready',
  MaxReached: 'max_reached',
} as const;
export type PotentialWindow = (typeof PotentialWindow)[keyof typeof PotentialWindow];

// Part I — appraiser fills in final result + rating per KRA
export const pmsKraRatingInput = z.object({
  kraId: z.string().uuid(),
  resultAchieved: z.string().min(1).max(2000),
  finalRating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});
export type PmsKraRatingInput = z.infer<typeof pmsKraRatingInput>;

export const savePmsKraRatings = z.object({
  cycleId: z.string().uuid(),
  ratings: z.array(pmsKraRatingInput).min(1).max(10),
});
export type SavePmsKraRatings = z.infer<typeof savePmsKraRatings>;

// Part II — appraiser picks anchor for each of the 22 dimensions
export const behaviouralRatingInput = z.object({
  dimensionCode: z.string().min(1),
  rating1to5: z.number().int().min(1).max(5),
  rubricAnchorText: z.string().min(1),
  comment: z.string().max(2000).optional(),
});
export type BehaviouralRatingInput = z.infer<typeof behaviouralRatingInput>;

export const saveBehaviouralRatings = z.object({
  cycleId: z.string().uuid(),
  ratings: z.array(behaviouralRatingInput).min(1).max(22),
});
export type SaveBehaviouralRatings = z.infer<typeof saveBehaviouralRatings>;

// Part III — staff contribution (bonus up to 5%)
export const staffContributionInput = z.object({
  whenDate: z.string().min(1).max(200),
  achievement: z.string().min(1).max(2000),
  weightPct: z.number().int().min(0).max(5),
});
export type StaffContributionInput = z.infer<typeof staffContributionInput>;

export const saveStaffContributions = z
  .object({
    cycleId: z.string().uuid(),
    contributions: z.array(staffContributionInput).max(20),
  })
  .refine((v) => v.contributions.reduce((s, c) => s + c.weightPct, 0) <= 5, {
    message: 'Total contribution weight must not exceed 5%',
  });
export type SaveStaffContributions = z.infer<typeof saveStaffContributions>;

// Part V(a) — career development
export const saveCareerDevelopment = z.object({
  cycleId: z.string().uuid(),
  potentialWindow: z.nativeEnum(PotentialWindow),
  readyIn: z.string().max(1000).optional(),
  comments: z.string().max(5000).optional(),
});
export type SaveCareerDevelopment = z.infer<typeof saveCareerDevelopment>;

// Part V(b) — personal growth
export const savePersonalGrowth = z.object({
  cycleId: z.string().uuid(),
  trainingNeeds: z.string().max(5000).optional(),
  comments: z.string().max(5000).optional(),
});
export type SavePersonalGrowth = z.infer<typeof savePersonalGrowth>;

// Part VI(a/b/c) — comments with signing
export const savePmsComment = z.object({
  cycleId: z.string().uuid(),
  role: z.nativeEnum(PmsCommentRole),
  body: z.string().min(1).max(5000),
});
export type SavePmsComment = z.infer<typeof savePmsComment>;

export const signPmsComment = z.object({
  commentId: z.string().uuid(),
  typedName: z.string().min(3).max(200),
});
export type SignPmsComment = z.infer<typeof signPmsComment>;

// Transition inputs
export const pmsCycleAction = z.object({
  cycleId: z.string().uuid(),
  note: z.string().max(2000).optional(),
});
export type PmsCycleAction = z.infer<typeof pmsCycleAction>;

export const openPmsWindow = z.object({
  cycleId: z.string().uuid(),
});
export type OpenPmsWindow = z.infer<typeof openPmsWindow>;

export const finalizePms = z.object({
  cycleId: z.string().uuid(),
});
export type FinalizePms = z.infer<typeof finalizePms>;
