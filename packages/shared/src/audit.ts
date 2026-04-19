import { z } from 'zod';

const base = z.object({
  ts: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  actorRole: z.string().nullable(),
  ip: z.string().nullable(),
  ua: z.string().nullable(),
});

export const auditEvent = z.discriminatedUnion('type', [
  base.extend({
    type: z.literal('cycle.opened'),
    target: z.object({ cycleId: z.string().uuid(), staffId: z.string().uuid(), fy: z.number() }),
  }),
  base.extend({
    type: z.literal('kra.drafted'),
    target: z.object({ cycleId: z.string().uuid() }),
    payload: z.object({ count: z.number(), totalWeight: z.number() }),
  }),
  base.extend({
    type: z.literal('kra.submitted'),
    target: z.object({ cycleId: z.string().uuid() }),
  }),
  base.extend({
    type: z.literal('kra.approved'),
    target: z.object({ cycleId: z.string().uuid() }),
  }),
  base.extend({
    type: z.literal('kra.rejected'),
    target: z.object({ cycleId: z.string().uuid() }),
    payload: z.object({ note: z.string() }),
  }),
  base.extend({
    type: z.literal('auth.login.success'),
    target: z.object({ userId: z.string().uuid() }),
  }),
  base.extend({
    type: z.literal('auth.login.failure'),
    target: z.object({ email: z.string() }),
    payload: z.object({ reason: z.string() }),
  }),
]);
export type AuditEvent = z.infer<typeof auditEvent>;
