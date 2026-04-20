process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { errorClient, setErrorClient } from '../src/observability/errors';

describe('error capture client', () => {
  let stderrLines: string[] = [];
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrLines = [];
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation((data: string | Uint8Array) => {
      if (typeof data === 'string') stderrLines.push(data);
      return true;
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('default client emits structured JSON to stderr', () => {
    errorClient.captureException(new Error('test error'), {
      requestId: 'req-123',
      userId: 'user-456',
    });
    expect(stderrLines.length).toBe(1);
    const parsed = JSON.parse(stderrLines[0]!);
    expect(parsed.event).toBe('unhandled_exception');
    expect(parsed.err).toContain('test error');
    expect(parsed.requestId).toBe('req-123');
    expect(parsed.userId).toBe('user-456');
  });

  it('redacts PII fields in tags', () => {
    errorClient.captureException(new Error('test'), {
      tags: { password: 'secret', someTag: 'safe-value' },
    });
    const parsed = JSON.parse(stderrLines[0]!);
    expect(parsed.tags.password).toBe('[REDACTED]');
    expect(parsed.tags.someTag).toBe('safe-value');
  });

  it('handles non-Error objects', () => {
    errorClient.captureException('plain string error');
    const parsed = JSON.parse(stderrLines[0]!);
    expect(parsed.err).toBe('plain string error');
  });

  it('setErrorClient replaces the default client', () => {
    const captured: unknown[] = [];
    setErrorClient({
      captureException(err) {
        captured.push(err);
      },
    });

    errorClient.captureException(new Error('custom client test'));
    expect(captured.length).toBe(1);

    // Reset to default-like behavior (re-import is tricky; just set back a stderr logger)
    setErrorClient({
      captureException(err, ctx) {
        const payload = {
          ts: new Date().toISOString(),
          level: 'error',
          event: 'unhandled_exception',
          err: String(err),
          ...ctx,
        };
        process.stderr.write(`${JSON.stringify(payload)}\n`);
      },
    });
  });
});
