import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const exportJob = pgTable('export_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  orgId: uuid('org_id').notNull(),
  params: jsonb('params').notNull().default({}),
  status: text('status').notNull().default('queued'),
  r2Key: text('r2_key'),
  sha256: text('sha256'),
  error: text('error'),
  rowCount: integer('row_count'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
