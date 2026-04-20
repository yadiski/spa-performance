import { date, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const staffImportBatch = pgTable('staff_import_batch', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  csvHash: text('csv_hash').notNull(),
  rowCount: integer('row_count').notNull(),
  /** 'pending' | 'validated' | 'applied' | 'reverted' | 'failed' */
  status: text('status').notNull().default('pending'),
  validationErrors: jsonb('validation_errors').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  /** Snapshot of staff rows as they were before apply, for reversal. */
  snapshotBefore: jsonb('snapshot_before'),
});

export const staffImportStage = pgTable('staff_import_stage', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchId: uuid('batch_id').notNull(),
  rowNum: integer('row_num').notNull(),
  employeeNo: text('employee_no').notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  designation: text('designation').notNull(),
  departmentCode: text('department_code').notNull(),
  gradeCode: text('grade_code').notNull(),
  managerEmployeeNo: text('manager_employee_no'),
  hireDate: date('hire_date').notNull(),
  roles: text('roles').notNull(),
  validationError: text('validation_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
