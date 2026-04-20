/**
 * T14 — CORS tightening tests
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { corsMiddleware } from '../src/http/cors';

// Helper to unset env vars in a way that satisfies both biome and tsc
const env = process.env as Record<string, string | undefined>;

function makeApp() {
  const app = new Hono();
  app.use('*', corsMiddleware);
  app.get('/', (c) => c.json({ ok: true }));
  app.options('/', (c) => c.text('ok'));
  return app;
}

describe('CORS middleware', () => {
  const originalWebOrigin = env.WEB_ORIGIN;
  const originalAdditional = env.ADDITIONAL_CORS_ORIGINS;
  const originalNodeEnv = env.NODE_ENV;

  beforeEach(() => {
    env.WEB_ORIGIN = 'http://localhost:5173';
    env.ADDITIONAL_CORS_ORIGINS = undefined;
  });

  afterEach(() => {
    env.WEB_ORIGIN = originalWebOrigin;
    env.ADDITIONAL_CORS_ORIGINS = originalAdditional;
    env.NODE_ENV = originalNodeEnv;
  });

  it('echoes origin for a request from WEB_ORIGIN', async () => {
    const res = await makeApp().request('/', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('does not set CORS headers for an unknown origin', async () => {
    const res = await makeApp().request('/', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows localhost:5173 in non-production (NODE_ENV=test)', async () => {
    env.NODE_ENV = 'test';
    const res = await makeApp().request('/', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('allows origins from ADDITIONAL_CORS_ORIGINS', async () => {
    env.ADDITIONAL_CORS_ORIGINS = 'https://staging.example.com,https://preview.example.com';
    const res = await makeApp().request('/', {
      headers: { Origin: 'https://staging.example.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://staging.example.com');
  });

  it('includes Access-Control-Allow-Credentials', async () => {
    const res = await makeApp().request('/', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('preflight OPTIONS returns 204 with correct headers for allowed origin', async () => {
    const res = await makeApp().request('/', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    // Hono CORS returns 204 for preflight
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeTruthy();
  });
});
