import { pgTable, pgEnum, text, timestamp, uuid, date } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { department, grade, organization } from './org';

export const roleEnum = pgEnum('role', [
  'staff',
  'appraiser',
  'next_level',
  'department_head',
  'hr_manager',
  'hra',
  'it_admin',
]);

export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'restrict' }).unique(),
  orgId: uuid('org_id').notNull().references(() => organization.id, { onDelete: 'restrict' }),
  employeeNo: text('employee_no').notNull().unique(),
  name: text('name').notNull(),
  designation: text('designation').notNull(),
  departmentId: uuid('department_id').notNull().references(() => department.id),
  gradeId: uuid('grade_id').notNull().references(() => grade.id),
  managerId: uuid('manager_id').references((): any => staff.id),
  hireDate: date('hire_date').notNull(),
  terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const staffRole = pgTable('staff_role', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
