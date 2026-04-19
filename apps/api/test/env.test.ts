// Ensure module-level env initialization has valid values during test import.
process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/db';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it } from 'bun:test';
import { loadEnv } from '../src/env';

describe('loadEnv', () => {
  it('parses valid env', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      BETTER_AUTH_URL: 'http://localhost:3000',
      NODE_ENV: 'test',
      API_PORT: '3000',
      WEB_ORIGIN: 'http://localhost:5173',
    });
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.API_PORT).toBe(3000);
  });

  it('rejects short secret', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://u:p@localhost:5432/db',
        BETTER_AUTH_SECRET: 'short',
        BETTER_AUTH_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
        API_PORT: '3000',
        WEB_ORIGIN: 'http://localhost:5173',
      }),
    ).toThrow();
  });
});
