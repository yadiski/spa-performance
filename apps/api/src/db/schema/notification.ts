import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { staff } from './staff';

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientStaffId: uuid('recipient_staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notification_recipient_read_created_idx').on(t.recipientStaffId, t.readAt, t.createdAt),
  ],
);
