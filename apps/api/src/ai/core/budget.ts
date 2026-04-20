import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { aiRateLimit, aiUsageDaily } from '../../db/schema/ai';

export interface BudgetConfig {
  dailyOrgTokenCap: number;
  userHourRequestCap: number;
}

export interface BudgetCheckInput {
  db: DB;
  orgId: string;
  userId: string;
  estimatedTokens: number; // prompt + expected completion
  config: BudgetConfig;
}

export type BudgetCheckResult =
  | { ok: true }
  | { ok: false; reason: 'org_daily_cap_exhausted' | 'user_hour_rate_limit' };

export const DEFAULT_BUDGET: BudgetConfig = {
  dailyOrgTokenCap: 200_000,
  userHourRequestCap: 20,
};

export async function checkBudget(input: BudgetCheckInput): Promise<BudgetCheckResult> {
  const { db, orgId, userId, estimatedTokens, config } = input;

  // Check org daily cap
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const usageRows = await db
    .select()
    .from(aiUsageDaily)
    .where(and(eq(aiUsageDaily.orgId, orgId), eq(aiUsageDaily.date, today)))
    .limit(1);

  const usage = usageRows[0];
  if (usage) {
    const totalTokens = Number(usage.promptTokens) + Number(usage.completionTokens);
    if (totalTokens + estimatedTokens > config.dailyOrgTokenCap) {
      return { ok: false, reason: 'org_daily_cap_exhausted' };
    }
  }

  // Check user hourly rate limit
  const bucketStart = new Date();
  bucketStart.setMinutes(0, 0, 0); // truncate to hour

  const rateLimitRows = await db
    .select()
    .from(aiRateLimit)
    .where(and(eq(aiRateLimit.userId, userId), eq(aiRateLimit.bucketStart, bucketStart)))
    .limit(1);

  const rateLimit = rateLimitRows[0];
  if (rateLimit && rateLimit.requests >= config.userHourRequestCap) {
    return { ok: false, reason: 'user_hour_rate_limit' };
  }

  return { ok: true };
}

export async function recordUsage(
  db: DB,
  opts: {
    orgId: string;
    userId: string;
    promptTokens: number;
    completionTokens: number;
  },
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    // Upsert ai_usage_daily
    await tx.execute(sql`
      INSERT INTO ai_usage_daily (org_id, date, prompt_tokens, completion_tokens, requests, updated_at)
      VALUES (${opts.orgId}::uuid, ${today}::date, ${opts.promptTokens}, ${opts.completionTokens}, 1, now())
      ON CONFLICT (org_id, date) DO UPDATE SET
        prompt_tokens = ai_usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
        completion_tokens = ai_usage_daily.completion_tokens + EXCLUDED.completion_tokens,
        requests = ai_usage_daily.requests + 1,
        updated_at = now()
    `);

    // Upsert ai_rate_limit
    const bucketStart = new Date();
    bucketStart.setMinutes(0, 0, 0);
    const bucketIso = bucketStart.toISOString();

    await tx.execute(sql`
      INSERT INTO ai_rate_limit (user_id, bucket_start, requests)
      VALUES (${opts.userId}::uuid, ${bucketIso}::timestamptz, 1)
      ON CONFLICT (user_id, bucket_start) DO UPDATE SET
        requests = ai_rate_limit.requests + 1
    `);
  });
}
