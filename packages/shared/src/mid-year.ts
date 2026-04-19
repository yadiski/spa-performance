import { z } from 'zod';

export const midYearKraUpdate = z.object({
  kraId: z.string().uuid(),
  resultAchieved: z.string().min(1).max(2000),
  informalRating: z.number().int().min(1).max(5),
});
export type MidYearKraUpdate = z.infer<typeof midYearKraUpdate>;

export const midYearSave = z.object({
  cycleId: z.string().uuid(),
  updates: z.array(midYearKraUpdate).min(1).max(10),
  summary: z.string().max(5000).optional(),
});
export type MidYearSave = z.infer<typeof midYearSave>;

export const midYearSubmit = z.object({
  cycleId: z.string().uuid(),
});
export type MidYearSubmit = z.infer<typeof midYearSubmit>;

export const midYearAck = z.object({
  cycleId: z.string().uuid(),
  note: z.string().max(2000).optional(),
});
export type MidYearAck = z.infer<typeof midYearAck>;

export const openMidYearWindow = z.object({
  cycleId: z.string().uuid(),
});
export type OpenMidYearWindow = z.infer<typeof openMidYearWindow>;
