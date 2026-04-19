import {
  customType,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { performanceCycle } from './cycle';
import { kra } from './kra';

const byteaType = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

export const pmsCommentRoleEnum = pgEnum('pms_comment_role', [
  'appraiser', // Part VI(a)
  'appraisee', // Part VI(b)
  'next_level', // Part VI(c)
]);

export const pmsAssessment = pgTable('pms_assessment', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleId: uuid('cycle_id')
    .notNull()
    .references(() => performanceCycle.id, { onDelete: 'cascade' })
    .unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pmsKraRating = pgTable('pms_kra_rating', {
  id: uuid('id').primaryKey().defaultRandom(),
  pmsId: uuid('pms_id')
    .notNull()
    .references(() => pmsAssessment.id, { onDelete: 'cascade' }),
  kraId: uuid('kra_id')
    .notNull()
    .references(() => kra.id, { onDelete: 'cascade' }),
  resultAchieved: text('result_achieved'),
  finalRating: integer('final_rating'),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const behaviouralRating = pgTable('behavioural_rating', {
  id: uuid('id').primaryKey().defaultRandom(),
  pmsId: uuid('pms_id')
    .notNull()
    .references(() => pmsAssessment.id, { onDelete: 'cascade' }),
  dimensionCode: text('dimension_code').notNull(),
  rating1to5: integer('rating_1_to_5').notNull(),
  rubricAnchorText: text('rubric_anchor_text').notNull(), // verbatim at rating time
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const staffContribution = pgTable('staff_contribution', {
  id: uuid('id').primaryKey().defaultRandom(),
  pmsId: uuid('pms_id')
    .notNull()
    .references(() => pmsAssessment.id, { onDelete: 'cascade' }),
  whenDate: text('when_date').notNull(), // free-text: "June 2026" etc
  achievement: text('achievement').notNull(),
  weightPct: integer('weight_pct').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const careerDevelopment = pgTable('career_development', {
  id: uuid('id').primaryKey().defaultRandom(),
  pmsId: uuid('pms_id')
    .notNull()
    .references(() => pmsAssessment.id, { onDelete: 'cascade' })
    .unique(),
  potentialWindow: text('potential_window').notNull(), // 'now' | '1-2_years' | 'after_2_years' | 'not_ready' | 'max_reached'
  readyIn: text('ready_in'), // optional freeform description
  comments: text('comments'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const personalGrowth = pgTable('personal_growth', {
  id: uuid('id').primaryKey().defaultRandom(),
  pmsId: uuid('pms_id')
    .notNull()
    .references(() => pmsAssessment.id, { onDelete: 'cascade' })
    .unique(),
  trainingNeeds: text('training_needs'),
  comments: text('comments'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pmsComment = pgTable('pms_comment', {
  id: uuid('id').primaryKey().defaultRandom(),
  pmsId: uuid('pms_id')
    .notNull()
    .references(() => pmsAssessment.id, { onDelete: 'cascade' }),
  role: pmsCommentRoleEnum('role').notNull(),
  body: text('body').notNull(),
  signedBy: uuid('signed_by').references(() => user.id),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  ip: text('ip'),
  ua: text('ua'),
  signatureHash: byteaType('signature_hash'), // null until signed
  prevSignatureHash: byteaType('prev_signature_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pmsFinalSnapshot = pgTable('pms_final_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  pmsId: uuid('pms_id')
    .notNull()
    .references(() => pmsAssessment.id, { onDelete: 'cascade' }),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull(),
  finalizedBy: uuid('finalized_by').notNull(),
  scoreTotal: text('score_total').notNull(), // numeric-as-text to avoid float surprises
  scoreBreakdown: jsonb('score_breakdown').notNull(),
  pdfR2Key: text('pdf_r2_key'), // populated by PDF job
  pdfSha256: text('pdf_sha256'),
  amendmentOfSnapshotId: uuid('amendment_of_snapshot_id').references(
    // biome-ignore lint/suspicious/noExplicitAny: drizzle self-reference requires any cast
    (): any => pmsFinalSnapshot.id,
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cycleAmendment = pgTable('cycle_amendment', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalCycleId: uuid('original_cycle_id')
    .notNull()
    .references(() => performanceCycle.id, { onDelete: 'restrict' }),
  originalSnapshotId: uuid('original_snapshot_id').references(() => pmsFinalSnapshot.id),
  reason: text('reason').notNull(),
  openedBy: uuid('opened_by').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});
