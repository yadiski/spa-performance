import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * T13 — Per-route HTTP rate-limit table.
 *
 * Bucket key format: "<class>:<identifier>:<window_start_epoch_seconds>"
 * e.g. "auth:ip:192.0.2.1:1713600000" or "mutating:user:uuid:1713600000"
 *
 * This is intentionally separate from ai_rate_limit (which tracks per-user
 * hourly AI API usage) because the key structure, window size, and capacity
 * semantics differ.
 */
export const httpRateLimit = pgTable(
  'http_rate_limit',
  {
    bucketKey: text('bucket_key').primaryKey(),
    requests: integer('requests').notNull().default(0),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('http_rate_limit_last_at_idx').on(t.lastAt)],
);
