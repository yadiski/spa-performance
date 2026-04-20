import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { canonicalHash, getCached, putCached } from '../src/ai/core/cache';
import { db } from '../src/db/client';

beforeEach(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table ai_cache, ai_usage_daily, ai_rate_limit`;
  await client.end({ timeout: 2 });
});

describe('canonicalHash', () => {
  it('produces a hex string', () => {
    const h = canonicalHash({ foo: 'bar' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const h1 = canonicalHash({ a: 1, b: 2 });
    const h2 = canonicalHash({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  it('is key-order independent', () => {
    const h1 = canonicalHash({ a: 1, b: 2 });
    const h2 = canonicalHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it('differs for different inputs', () => {
    const h1 = canonicalHash({ a: 1 });
    const h2 = canonicalHash({ a: 2 });
    expect(h1).not.toBe(h2);
  });

  it('handles nested objects with key-order independence', () => {
    const h1 = canonicalHash({ x: { a: 1, b: 2 }, y: 'hello' });
    const h2 = canonicalHash({ y: 'hello', x: { b: 2, a: 1 } });
    expect(h1).toBe(h2);
  });

  it('handles arrays (order-sensitive)', () => {
    const h1 = canonicalHash([1, 2, 3]);
    const h2 = canonicalHash([3, 2, 1]);
    expect(h1).not.toBe(h2);
  });
});

describe('getCached', () => {
  it('returns null on cache miss', async () => {
    const result = await getCached(db, {
      feature: 'staff_summary',
      scopeKey: 'org:abc|subject:123',
      contentHash: 'deadbeef',
      model: 'openai/gpt-4',
    });
    expect(result).toBeNull();
  });
});

describe('putCached + getCached', () => {
  it('roundtrip: put then get returns the same output', async () => {
    const key = {
      feature: 'staff_summary',
      scopeKey: 'org:test-org|subject:cycle-1',
      contentHash: canonicalHash({ staffId: 'abc', cycleId: '123' }),
      model: 'openai/gpt-4o-mini',
    };
    const value = {
      output: { summary: 'This staff member is excellent.', rating: 5 },
      promptTokens: 150,
      completionTokens: 80,
    };

    await putCached(db, key, value);
    const cached = await getCached(db, key);

    expect(cached).not.toBeNull();
    expect(cached?.output).toMatchObject(value.output as object);
    expect(cached?.promptTokens).toBe(150);
    expect(cached?.completionTokens).toBe(80);
    expect(cached?.createdAt).toBeInstanceOf(Date);
  });

  it('put is idempotent (onConflictDoNothing)', async () => {
    const key = {
      feature: 'kra_quality',
      scopeKey: 'org:x|subject:y',
      contentHash: canonicalHash({ test: true }),
      model: 'openai/gpt-4',
    };

    await putCached(db, key, { output: { first: true }, promptTokens: 10, completionTokens: 5 });
    // Second put with different value should not overwrite
    await putCached(db, key, { output: { first: false }, promptTokens: 99, completionTokens: 99 });

    const cached = await getCached(db, key);
    expect((cached?.output as { first: boolean })?.first).toBe(true);
    expect(cached?.promptTokens).toBe(10);
  });

  it('different models get separate cache entries', async () => {
    const baseKey = {
      feature: 'staff_summary',
      scopeKey: 'org:x|subject:y',
      contentHash: canonicalHash({ test: 'model-separation' }),
    };

    await putCached(
      db,
      { ...baseKey, model: 'openai/gpt-4' },
      { output: { model: 'gpt4' }, promptTokens: 100, completionTokens: 50 },
    );
    await putCached(
      db,
      { ...baseKey, model: 'openai/gpt-4o-mini' },
      { output: { model: 'mini' }, promptTokens: 50, completionTokens: 25 },
    );

    const r1 = await getCached(db, { ...baseKey, model: 'openai/gpt-4' });
    const r2 = await getCached(db, { ...baseKey, model: 'openai/gpt-4o-mini' });

    expect((r1?.output as { model: string })?.model).toBe('gpt4');
    expect((r2?.output as { model: string })?.model).toBe('mini');
  });
});
