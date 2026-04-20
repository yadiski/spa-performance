import {
  bigserial,
  boolean,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const authFailedAttempt = pgTable(
  'auth_failed_attempt',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    userId: uuid('user_id'),
    emailTried: text('email_tried'),
    ip: inet('ip'),
    ua: text('ua'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_failed_attempt_user_idx').on(t.userId, t.occurredAt),
    index('auth_failed_attempt_email_idx').on(t.emailTried, t.occurredAt),
  ],
);

export const accountLockout = pgTable('account_lockout', {
  userId: uuid('user_id').primaryKey(),
  lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }).notNull(),
  lockedBySystem: boolean('locked_by_system').notNull().default(true),
  unlockReason: text('unlock_reason'),
});

export const impersonationSession = pgTable(
  'impersonation_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    impersonatorUserId: uuid('impersonator_user_id').notNull(),
    targetUserId: uuid('target_user_id').notNull(),
    reason: text('reason').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedReason: text('ended_reason'),
    targetNotifiedAt: timestamp('target_notified_at', { withTimezone: true }),
  },
  (t) => [index('impersonation_active_idx').on(t.impersonatorUserId, t.endedAt)],
);

export const mfaRecoveryCode = pgTable(
  'mfa_recovery_code',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mfa_recovery_code_user_idx').on(t.userId)],
);
