import { bigserial, customType, date, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  eventType: text('event_type').notNull(),
  actorId: uuid('actor_id'),
  actorRole: text('actor_role'),
  targetType: text('target_type'),
  targetId: text('target_id'),
  payload: jsonb('payload').notNull(),
  ip: inet('ip'),
  ua: text('ua'),
  prevHash: bytea('prev_hash').notNull(),
  hash: bytea('hash').notNull(),
  chainRoot: bytea('chain_root').notNull(),
});

export const auditAnchor = pgTable('audit_anchor', {
  date: date('date').primaryKey(),
  rootHash: bytea('root_hash').notNull(),
});
