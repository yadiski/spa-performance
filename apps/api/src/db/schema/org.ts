import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const organization = pgTable('organization', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  fiscalYearStartMonth: text('fiscal_year_start_month').notNull().default('01'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const department = pgTable('department', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organization.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const grade = pgTable('grade', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organization.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  rank: text('rank').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
