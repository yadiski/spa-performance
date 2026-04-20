import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const aiCache = pgTable(
  'ai_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feature: text('feature').notNull(),
    scopeKey: text('scope_key').notNull(),
    contentHash: text('content_hash').notNull(),
    model: text('model').notNull(),
    output: jsonb('output').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_cache_feature_scope_key_idx').on(t.feature, t.scopeKey)],
);

export const aiUsageDaily = pgTable('ai_usage_daily', {
  orgId: uuid('org_id').notNull(),
  date: date('date').notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  requests: integer('requests').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiRateLimit = pgTable('ai_rate_limit', {
  userId: uuid('user_id').notNull(),
  bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
  requests: integer('requests').notNull().default(0),
});
