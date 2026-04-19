import { z } from 'zod';
import { CycleState } from './enums';

export const openCycle = z.object({
  staffId: z.string().uuid(),
  fy: z.number().int().min(2000).max(2100),
});
export type OpenCycle = z.infer<typeof openCycle>;

export const cycleTransition = z.object({
  from: z.nativeEnum(CycleState),
  to: z.nativeEnum(CycleState),
  note: z.string().max(2000).optional(),
});
export type CycleTransition = z.infer<typeof cycleTransition>;
