import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { writeAudit } from '../../audit/log';
import type { DB } from '../../db/client';
import { type BudgetConfig, DEFAULT_BUDGET, checkBudget, recordUsage } from './budget';
import { canonicalHash, getCached, putCached } from './cache';
import { callOpenRouter } from './openrouter';

export interface DispatchInput<TInput, TOutput> {
  db: DB;
  actor: { userId: string; orgId: string; staffId: string | null; roles: string[] };
  feature: string; // 'staff_summary' etc
  scopeKey: string; // caller-provided, MUST include actor-bounded namespace
  input: TInput;
  model: string;
  temperature?: number;
  maxTokens?: number;
  buildMessages: (
    input: TInput,
  ) => Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  responseSchema: z.ZodType<TOutput>; // runtime validator
  jsonSchema: Record<string, unknown>; // JSON schema for OpenRouter response_format
  budgetConfig?: BudgetConfig;
}

export type DispatchResult<TOutput> =
  | {
      ok: true;
      cached: boolean;
      output: TOutput;
      promptTokens: number;
      completionTokens: number;
    }
  | {
      ok: false;
      error: 'budget_exhausted' | 'rate_limited' | 'schema_failed' | 'openrouter_error';
      message: string;
    };

export async function dispatch<TInput, TOutput>(
  input: DispatchInput<TInput, TOutput>,
): Promise<DispatchResult<TOutput>> {
  const {
    db,
    actor,
    feature,
    scopeKey,
    model,
    temperature,
    maxTokens,
    buildMessages,
    responseSchema,
    jsonSchema,
    budgetConfig = DEFAULT_BUDGET,
  } = input;

  // Step 1: Compute content hash
  const contentHash = canonicalHash(input.input);

  // Step 2: Check cache (pre-lock)
  const cached = await getCached(db, { feature, scopeKey, contentHash, model });
  if (cached) {
    const parseResult = responseSchema.safeParse(cached.output);
    if (parseResult.success) {
      return {
        ok: true,
        cached: true,
        output: parseResult.data,
        promptTokens: cached.promptTokens,
        completionTokens: cached.completionTokens,
      };
    }
  }

  // Step 3: Acquire advisory lock and re-check cache inside transaction
  // We use a single-connection transaction for the advisory lock
  // The lock is held across the OpenRouter call to prevent thundering herd
  const lockKey = `hashtext('ai:' || ${feature} || ':' || ${scopeKey} || ':' || ${contentHash})`;

  // Compute an integer lock key using a simple hash
  const lockKeyStr = `ai:${feature}:${scopeKey}:${contentHash}`;
  const lockInt = hashStringToInt(lockKeyStr);

  // We run the whole flow inside a raw postgres advisory lock
  // Since we can't hold a drizzle tx open across fetch, we use session-level advisory lock
  const result = await db.transaction(async (tx) => {
    // Acquire session-level advisory lock (xact-level would auto-release at tx end)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockInt})`);

    // Step 4: Re-check cache after acquiring lock
    const cachedAfterLock = await getCached(db, { feature, scopeKey, contentHash, model });
    if (cachedAfterLock) {
      const parseResult = responseSchema.safeParse(cachedAfterLock.output);
      if (parseResult.success) {
        return {
          ok: true as const,
          cached: true,
          output: parseResult.data,
          promptTokens: cachedAfterLock.promptTokens,
          completionTokens: cachedAfterLock.completionTokens,
        };
      }
    }

    // Step 5: Check budget
    const budgetResult = await checkBudget({
      db,
      orgId: actor.orgId,
      userId: actor.userId,
      estimatedTokens: 2000, // conservative estimate before actual call
      config: budgetConfig,
    });

    if (!budgetResult.ok) {
      await writeAudit(tx, {
        eventType: 'ai.budget_exhausted',
        actorId: actor.userId,
        actorRole: actor.roles[0] ?? null,
        targetType: 'ai_feature',
        targetId: feature,
        payload: { feature, orgId: actor.orgId, reason: budgetResult.reason },
        ip: null,
        ua: null,
      });

      return {
        ok: false as const,
        error:
          budgetResult.reason === 'user_hour_rate_limit'
            ? ('rate_limited' as const)
            : ('budget_exhausted' as const),
        message: budgetResult.reason,
      };
    }

    // Step 6: Build messages
    const messages = buildMessages(input.input);

    // Step 7: Call OpenRouter
    let callResult: Awaited<ReturnType<typeof callOpenRouter>>;
    try {
      callResult = await callOpenRouter({
        model,
        messages,
        responseSchema: jsonSchema,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeAudit(tx, {
        eventType: 'ai.call_failed',
        actorId: actor.userId,
        actorRole: actor.roles[0] ?? null,
        targetType: 'ai_feature',
        targetId: feature,
        payload: { feature, scopeKey, model, error: message },
        ip: null,
        ua: null,
      });
      return {
        ok: false as const,
        error: 'openrouter_error' as const,
        message,
      };
    }

    // Step 8: Validate output schema
    const parseResult = responseSchema.safeParse(callResult.content);
    if (!parseResult.success) {
      const rawStr = JSON.stringify(callResult.content).slice(0, 1000);
      await writeAudit(tx, {
        eventType: 'ai.schema_failed',
        actorId: actor.userId,
        actorRole: actor.roles[0] ?? null,
        targetType: 'ai_feature',
        targetId: feature,
        payload: {
          feature,
          scopeKey,
          model,
          raw: rawStr,
          error: parseResult.error.message,
        },
        ip: null,
        ua: null,
      });
      return {
        ok: false as const,
        error: 'schema_failed' as const,
        message: parseResult.error.message,
      };
    }

    // Step 9: Write cache
    await putCached(
      db,
      { feature, scopeKey, contentHash, model },
      {
        output: callResult.content,
        promptTokens: callResult.promptTokens,
        completionTokens: callResult.completionTokens,
      },
    );

    // Step 10: Record usage
    await recordUsage(db, {
      orgId: actor.orgId,
      userId: actor.userId,
      promptTokens: callResult.promptTokens,
      completionTokens: callResult.completionTokens,
    });

    // Step 11: Write success audit
    await writeAudit(tx, {
      eventType: 'ai.call_succeeded',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'ai_feature',
      targetId: feature,
      payload: {
        feature,
        scopeKey,
        contentHash,
        model: callResult.model,
        promptTokens: callResult.promptTokens,
        completionTokens: callResult.completionTokens,
      },
      ip: null,
      ua: null,
    });

    // Step 12: Return result
    return {
      ok: true as const,
      cached: false,
      output: parseResult.data,
      promptTokens: callResult.promptTokens,
      completionTokens: callResult.completionTokens,
    };
  });

  return result as DispatchResult<TOutput>;
}

/**
 * Maps a string to a 32-bit integer suitable for pg_advisory_xact_lock.
 * Uses a simple FNV-1a-like fold of the first 8 bytes of a sha256.
 */
function hashStringToInt(s: string): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to signed 32-bit for postgres bigint compatibility
  return hash | 0;
}
