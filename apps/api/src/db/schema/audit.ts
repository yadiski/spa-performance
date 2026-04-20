import {
  bigserial,
  customType,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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
  requestId: text('request_id'),
  prevHash: bytea('prev_hash').notNull(),
  hash: bytea('hash').notNull(),
  chainRoot: bytea('chain_root').notNull(),
});

export const auditAnchor = pgTable('audit_anchor', {
  date: date('date').primaryKey(),
  rootHash: bytea('root_hash').notNull(),
});

export const auditArchiveManifest = pgTable(
  'audit_archive_manifest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    r2Key: text('r2_key').notNull().unique(),
    sha256: text('sha256').notNull(),
    rowCount: integer('row_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_archive_manifest_period_idx').on(t.periodStart, t.periodEnd)],
);
