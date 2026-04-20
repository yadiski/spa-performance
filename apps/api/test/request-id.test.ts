process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';
process.env.HEALTH_CHECK_TOKEN ??= 'test-health-token-secret';

import { describe, expect, it } from 'bun:test';
import { app } from '../src/http/app';

describe('request-id middleware', () => {
  it('generates and returns X-Request-Id in response headers', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const rid = res.headers.get('x-request-id');
    expect(rid).toBeDefined();
    expect(typeof rid).toBe('string');
    expect(rid!.length).toBeGreaterThan(0);
  });

  it('echoes back X-Request-Id when provided in request', async () => {
    const res = await app.request('/healthz', {
      headers: { 'x-request-id': 'my-custom-id-abc' },
    });
    expect(res.headers.get('x-request-id')).toBe('my-custom-id-abc');
  });

  it('generates different ids for each request when none provided', async () => {
    const res1 = await app.request('/healthz');
    const res2 = await app.request('/healthz');
    const id1 = res1.headers.get('x-request-id');
    const id2 = res2.headers.get('x-request-id');
    expect(id1).not.toBe(id2);
  });
});

describe('GET /api/v1/healthz/deep', () => {
  it('returns 401 without token', async () => {
    const res = await app.request('/api/v1/healthz/deep');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong token', async () => {
    const res = await app.request('/api/v1/healthz/deep', {
      headers: { 'x-health-token': 'wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct token when DB is accessible', async () => {
    const res = await app.request('/api/v1/healthz/deep', {
      headers: { 'x-health-token': 'test-health-token-secret' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { db: string; r2: string; timestamp: string };
    expect(body.db).toBe('ok');
    expect(['ok', 'unconfigured']).toContain(body.r2);
    expect(typeof body.timestamp).toBe('string');
  });
});
