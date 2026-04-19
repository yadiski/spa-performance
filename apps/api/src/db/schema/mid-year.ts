import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { performanceCycle } from './cycle';

export const midYearCheckpoint = pgTable('mid_year_checkpoint', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleId: uuid('cycle_id')
    .notNull()
    .references(() => performanceCycle.id, { onDelete: 'cascade' })
    .unique(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by'),
  ackedAt: timestamp('acked_at', { withTimezone: true }),
  ackedBy: uuid('acked_by'),
  summary: text('summary'),
  nudgesAccepted: jsonb('nudges_accepted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
