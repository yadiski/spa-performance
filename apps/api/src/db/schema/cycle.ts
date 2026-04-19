import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { staff } from './staff';

export const cycleStateEnum = pgEnum('cycle_state', [
  'kra_drafting',
  'kra_pending_approval',
  'kra_approved',
  'mid_year_open',
  'mid_year_submitted',
  'mid_year_done',
  'pms_self_review',
  'pms_awaiting_appraiser',
  'pms_awaiting_next_lvl',
  'pms_awaiting_hra',
  'pms_finalized',
]);

export const performanceCycle = pgTable('performance_cycle', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id')
    .notNull()
    .references(() => staff.id, { onDelete: 'restrict' }),
  fy: integer('fy').notNull(),
  state: cycleStateEnum('state').notNull().default('kra_drafting'),
  kraSetAt: timestamp('kra_set_at', { withTimezone: true }),
  midYearAt: timestamp('mid_year_at', { withTimezone: true }),
  pmsFinalizedAt: timestamp('pms_finalized_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalTransition = pgTable('approval_transition', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleId: uuid('cycle_id')
    .notNull()
    .references(() => performanceCycle.id, { onDelete: 'cascade' }),
  fromState: cycleStateEnum('from_state').notNull(),
  toState: cycleStateEnum('to_state').notNull(),
  actorId: uuid('actor_id').notNull(),
  note: text('note'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
