import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { aiCache } from '../../db/schema/ai';

export interface CacheKey {
  feature: string;
  scopeKey: string;
  contentHash: string;
  model: string;
}

export interface CacheEntry {
  output: unknown;
  promptTokens: number;
  completionTokens: number;
  createdAt: Date;
}

export async function getCached(db: DB, key: CacheKey): Promise<CacheEntry | null> {
  const rows = await db
    .select()
    .from(aiCache)
    .where(
      and(
        eq(aiCache.feature, key.feature),
        eq(aiCache.scopeKey, key.scopeKey),
        eq(aiCache.contentHash, key.contentHash),
        eq(aiCache.model, key.model),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    output: row.output,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    createdAt: row.createdAt,
  };
}

export async function putCached(
  db: DB,
  key: CacheKey,
  value: { output: unknown; promptTokens: number; completionTokens: number },
): Promise<void> {
  await db
    .insert(aiCache)
    .values({
      feature: key.feature,
      scopeKey: key.scopeKey,
      contentHash: key.contentHash,
      model: key.model,
      output: value.output as Record<string, unknown>,
      promptTokens: value.promptTokens,
      completionTokens: value.completionTokens,
    })
    .onConflictDoNothing();
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalHash(input: unknown): string {
  const sorted = sortKeys(input);
  const json = JSON.stringify(sorted);
  return createHash('sha256').update(json).digest('hex');
}
