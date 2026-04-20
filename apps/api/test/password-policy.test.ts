/**
 * T9 — Password policy tests
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { MIN_LENGTH, checkPassword } from '../src/auth/password-policy';

// Helper to stub globalThis.fetch and restore it
function withFetch(
  impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  // biome-ignore lint/suspicious/noExplicitAny: mocking fetch for tests
  (globalThis as any).fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

describe('password policy', () => {
  it('rejects passwords shorter than MIN_LENGTH', async () => {
    const short = 'a'.repeat(MIN_LENGTH - 1);
    const result = await checkPassword(short);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too_short');
    }
  });

  it('accepts exactly MIN_LENGTH chars (length check)', async () => {
    const elevenChars = 'abc123!@#DE';
    expect(elevenChars.length).toBe(11);
    const result2 = await checkPassword(elevenChars);
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.reason).toBe('too_short');
  });

  it('accepts a strong password (mocked HIBP — not breached)', async () => {
    await withFetch(
      async (url) => {
        if (String(url).includes('pwnedpasswords.com')) {
          return new Response('AAAAA:0\nBBBBB:1', { status: 200 });
        }
        return new Response('', { status: 200 });
      },
      async () => {
        const result = await checkPassword('ThisIs@StrongPassword!99');
        expect(result.ok).toBe(true);
      },
    );
  });

  it('rejects a known-breached password (stubbed HIBP)', async () => {
    const password = 'correct-horse-battery-12';
    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const suffix = hash.slice(5);

    await withFetch(
      async (url) => {
        if (String(url).includes('pwnedpasswords.com')) {
          return new Response(`${suffix}:5000`, { status: 200 });
        }
        return new Response('', { status: 200 });
      },
      async () => {
        const result = await checkPassword(password);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe('breached');
        }
      },
    );
  });

  it('HIBP timeout/network failure does not block (returns ok)', async () => {
    await withFetch(
      async (_url) => {
        throw new Error('Network error');
      },
      async () => {
        const result = await checkPassword('StrongPasswordThatPasses!123');
        expect(result.ok).toBe(true); // fail-open
      },
    );
  });

  it('HIBP AbortError does not block (returns ok)', async () => {
    await withFetch(
      async (_url) => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      },
      async () => {
        const result = await checkPassword('AnotherStrongPassword!456');
        expect(result.ok).toBe(true); // fail-open on abort
      },
    );
  });
});
