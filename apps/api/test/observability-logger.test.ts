process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { log, logError, logInfo, logWarn } from '../src/observability/logger';

describe('structured JSON logger', () => {
  let lines: string[] = [];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    lines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('emits valid JSON with required fields', () => {
    logInfo('test message', { requestId: 'req-abc' });
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('test message');
    expect(parsed.requestId).toBe('req-abc');
    expect(typeof parsed.ts).toBe('string');
  });

  it('redacts password field', () => {
    log({ level: 'info', msg: 'login attempt', password: 'secret123' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.password).toBe('[REDACTED]');
  });

  it('redacts totp_code field', () => {
    log({ level: 'info', msg: 'totp check', totp_code: '123456' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.totp_code).toBe('[REDACTED]');
  });

  it('redacts totpCode field', () => {
    log({ level: 'info', msg: 'totp check', totpCode: '123456' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.totpCode).toBe('[REDACTED]');
  });

  it('redacts session_token field', () => {
    log({ level: 'info', msg: 'session', session_token: 'tok-xyz' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.session_token).toBe('[REDACTED]');
  });

  it('redacts sessionToken field', () => {
    log({ level: 'info', msg: 'session', sessionToken: 'tok-xyz' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.sessionToken).toBe('[REDACTED]');
  });

  it('redacts authorization field', () => {
    log({ level: 'info', msg: 'auth', authorization: 'Bearer secret' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.authorization).toBe('[REDACTED]');
  });

  it('keeps email by default', () => {
    log({ level: 'info', msg: 'user event', email: 'user@example.com' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.email).toBe('user@example.com');
  });

  it('redacts email when __redactEmail is true', () => {
    log({ level: 'info', msg: 'user event', email: 'user@example.com', __redactEmail: true });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.email).toBe('[REDACTED]');
  });

  it('does not emit __redactEmail in output', () => {
    log({ level: 'info', msg: 'test', __redactEmail: true });
    const parsed = JSON.parse(lines[0]!);
    expect(Object.keys(parsed)).not.toContain('__redactEmail');
  });

  it('logWarn emits level warn', () => {
    logWarn('warning msg');
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe('warn');
  });

  it('logError emits level error', () => {
    logError('error msg');
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe('error');
  });
});
