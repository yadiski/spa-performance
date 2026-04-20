import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const calibrationNote = pgTable(
  'calibration_note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    gradeId: uuid('grade_id').notNull(),
    fy: integer('fy').notNull(),
    subjectStaffId: uuid('subject_staff_id'),
    subjectKey: text('subject_key').notNull(),
    subjectName: text('subject_name').notNull(),
    note: text('note').notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('calibration_note_cohort_idx').on(t.gradeId, t.fy, t.createdAt),
    index('calibration_note_subject_idx').on(t.subjectKey, t.createdAt),
  ],
);
