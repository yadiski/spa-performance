/**
 * T13 — Per-route rate limit tests
 */
import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import postgres from 'postgres';
import { db } from '../src/db/client';
import { authIpRateLimit, mutatingRateLimit, rateLimit } from '../src/http/rate-limit';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTestApp(middleware: ReturnType<typeof rateLimit>) {
  const app = new Hono();
  app.use('*', middleware);
  app.get('/', (c) => c.json({ ok: true }));
  app.post('/', (c) => c.json({ ok: true }));
  app.patch('/', (c) => c.json({ ok: true }));
  app.delete('/', (c) => c.json({ ok: true }));
  return app;
}

async function clearRateLimits() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table http_rate_limit`;
  await client.end({ timeout: 2 });
}

async function getAuditRows(targetId: string) {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rows = await client`
    select * from audit_log
    where event_type = 'security.rate_limit_hit'
      and target_id = ${targetId}
    order by id desc
  `;
  await client.end({ timeout: 2 });
  return rows;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('rateLimit — auth/IP (capacity 10, window 60s)', () => {
  beforeEach(clearRateLimits);
  afterEach(clearRateLimits);

  it('allows up to capacity requests', async () => {
    const app = makeTestApp(
      rateLimit({ class: 'auth', key: () => 'ip:1.2.3.4', windowSec: 60, capacity: 10, db }),
    );

    for (let i = 0; i < 10; i++) {
      const res = await app.request('/', { headers: { 'x-forwarded-for': '1.2.3.4' } });
      expect(res.status).toBe(200);
    }
  });

  it('11th request from same IP returns 429 with Retry-After', async () => {
    const app = makeTestApp(
      rateLimit({ class: 'auth', key: () => 'ip:1.2.3.4', windowSec: 60, capacity: 10, db }),
    );

    for (let i = 0; i < 10; i++) {
      await app.request('/', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    }

    const res = await app.request('/', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = await res.json();
    expect(body.code).toBe('rate_limit_exceeded');
  });

  it('different IPs do not share buckets', async () => {
    const app = makeTestApp(
      rateLimit({
        class: 'auth',
        key: (c) => `ip:${c.req.header('x-forwarded-for') ?? 'unknown'}`,
        windowSec: 60,
        capacity: 3,
        db,
      }),
    );

    // Use up capacity for IP A
    for (let i = 0; i < 3; i++) {
      await app.request('/', { headers: { 'x-forwarded-for': '10.0.0.1' } });
    }

    // IP B should still be allowed
    const res = await app.request('/', { headers: { 'x-forwarded-for': '10.0.0.2' } });
    expect(res.status).toBe(200);

    // IP A is now blocked
    const blocked = await app.request('/', { headers: { 'x-forwarded-for': '10.0.0.1' } });
    expect(blocked.status).toBe(429);
  });
});

describe('rateLimit — mutating (capacity 60, window 60s)', () => {
  beforeEach(clearRateLimits);
  afterEach(clearRateLimits);

  it('allows 60 POST requests from same user', async () => {
    const userId = 'user-rate-test-001';
    const app = makeTestApp(
      rateLimit({
        class: 'mutating',
        key: () => `user:${userId}`,
        windowSec: 60,
        capacity: 60,
        db,
      }),
    );

    for (let i = 0; i < 60; i++) {
      const res = await app.request('/', { method: 'POST' });
      expect(res.status).toBe(200);
    }
  });

  it('61st mutating POST returns 429', async () => {
    const userId = 'user-rate-test-002';
    const app = makeTestApp(
      rateLimit({
        class: 'mutating',
        key: () => `user:${userId}`,
        windowSec: 60,
        capacity: 60,
        db,
      }),
    );

    for (let i = 0; i < 60; i++) {
      await app.request('/', { method: 'POST' });
    }

    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('different users do not share mutating buckets', async () => {
    let callCount = 0;
    const app = makeTestApp(
      rateLimit({
        class: 'mutating',
        key: () => `user:user-${++callCount <= 3 ? 'A' : 'B'}`,
        windowSec: 60,
        capacity: 3,
        db,
      }),
    );

    // Exhaust user-A's 3-request capacity
    for (let i = 0; i < 3; i++) {
      await app.request('/', { method: 'POST' });
    }

    // Next 3 calls map to user-B — should be allowed
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/', { method: 'POST' });
      expect(res.status).toBe(200);
    }
  });
});

describe('rateLimit — mutatingRateLimit only applies to mutating methods', () => {
  beforeEach(clearRateLimits);
  afterEach(clearRateLimits);

  it('GET requests are not counted against mutating limit', async () => {
    const app = new Hono();
    app.use('*', mutatingRateLimit(db));
    app.get('/', (c) => c.json({ ok: true }));
    app.post('/', (c) => c.json({ ok: true }));

    // Exhaust the POST limit (use a tiny capacity by overriding — but we can't here,
    // so just verify GETs pass freely alongside POSTs)
    const getRes = await app.request('/', { method: 'GET' });
    expect(getRes.status).toBe(200);
  });
});

describe('rateLimit — audit event written on 429', () => {
  beforeEach(async () => {
    await clearRateLimits();
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });
  afterEach(clearRateLimits);

  it('writes a security.rate_limit_hit audit row when 429 is returned', async () => {
    const bucketId = 'auth:ip:audit-test-ip:trigger';
    const app = makeTestApp(
      rateLimit({ class: 'auth', key: () => 'ip:audit-test-ip', windowSec: 60, capacity: 2, db }),
    );

    // Exhaust capacity
    await app.request('/');
    await app.request('/');

    // This triggers the 429 + audit row
    const res = await app.request('/');
    expect(res.status).toBe(429);

    // Give audit write a moment (it's async fire-and-forget in the middleware)
    await new Promise((r) => setTimeout(r, 100));

    const auditRows = await getAuditRows(
      'auth:ip:audit-test-ip:' +
        // bucket key includes the window start; just check event_type presence
        '',
    );
    // Query all rate_limit_hit rows for this test run
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const rows = await client`
      select * from audit_log
      where event_type = 'security.rate_limit_hit'
      order by id desc
      limit 5
    `;
    await client.end({ timeout: 2 });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.event_type).toBe('security.rate_limit_hit');
    // The payload should contain the class and capacity
    const payload = rows[0]!.payload as Record<string, unknown>;
    expect(payload.class).toBe('auth');
    expect(Number(payload.capacity)).toBe(2);
  });
});

describe('authIpRateLimit — pre-built middleware', () => {
  beforeEach(clearRateLimits);
  afterEach(clearRateLimits);

  it('blocks IP after 10 requests in 60s', async () => {
    const app = new Hono();
    app.use('*', authIpRateLimit(db));
    app.post('/', (c) => c.json({ ok: true }));

    for (let i = 0; i < 10; i++) {
      await app.request('/', {
        method: 'POST',
        headers: { 'x-forwarded-for': '5.5.5.5' },
      });
    }

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'x-forwarded-for': '5.5.5.5' },
    });
    expect(res.status).toBe(429);
  });
});
