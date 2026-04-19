import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { performanceCycle } from './cycle';

export const perspectiveEnum = pgEnum('kra_perspective', [
  'financial',
  'customer',
  'internal_process',
  'learning_growth',
]);

export const kra = pgTable('kra', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleId: uuid('cycle_id').notNull().references(() => performanceCycle.id, { onDelete: 'cascade' }),
  perspective: perspectiveEnum('perspective').notNull(),
  description: text('description').notNull(),
  weightPct: integer('weight_pct').notNull(),
  measurement: text('measurement').notNull(),
  target: text('target').notNull(),
  order: integer('order').notNull(),
  rubric1to5: jsonb('rubric_1_to_5').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kraProgressUpdate = pgTable('kra_progress_update', {
  id: uuid('id').primaryKey().defaultRandom(),
  kraId: uuid('kra_id').notNull().references(() => kra.id, { onDelete: 'cascade' }),
  reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  byRole: text('by_role').notNull(),
  resultAchieved: text('result_achieved').notNull(),
  rating1to5: integer('rating_1_to_5').notNull(),
});
