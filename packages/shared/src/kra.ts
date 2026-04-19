import { z } from 'zod';
import { KraPerspective } from './enums';

export const kraAnchors = z.array(z.string().min(1).max(500)).length(5);

export const kraDraft = z.object({
  id: z.string().uuid().optional(),
  perspective: z.nativeEnum(KraPerspective),
  description: z.string().min(10).max(2000),
  weightPct: z.number().int().min(1).max(100),
  measurement: z.string().min(5).max(1000),
  target: z.string().min(1).max(500),
  order: z.number().int().min(0),
  rubric1to5: kraAnchors,
});
export type KraDraft = z.infer<typeof kraDraft>;

export const kraCreateBatch = z.object({
  cycleId: z.string().uuid(),
  kras: z.array(kraDraft).min(3).max(5),
}).refine(
  (v) => v.kras.reduce((s, k) => s + k.weightPct, 0) === 100,
  { message: 'KRA weights must total 100%' },
);
export type KraCreateBatch = z.infer<typeof kraCreateBatch>;

export const kraApprove = z.object({
  cycleId: z.string().uuid(),
});
export type KraApprove = z.infer<typeof kraApprove>;

export const kraReject = z.object({
  cycleId: z.string().uuid(),
  note: z.string().min(3).max(2000),
});
export type KraReject = z.infer<typeof kraReject>;
