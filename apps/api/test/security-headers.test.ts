/**
 * T12 — Security headers tests
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { securityHeaders } from '../src/http/security-headers';

function makeApp(opts?: Parameters<typeof securityHeaders>[0]) {
  const app = new Hono();
  app.use('*', securityHeaders(opts));
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

describe('securityHeaders middleware', () => {
  it('sets HSTS header on every response', async () => {
    const res = await makeApp().request('/');
    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await makeApp().request('/');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', async () => {
    const res = await makeApp().request('/');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets Referrer-Policy: no-referrer', async () => {
    const res = await makeApp().request('/');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('sets Permissions-Policy disabling sensitive features', async () => {
    const res = await makeApp().request('/');
    const pp = res.headers.get('Permissions-Policy') ?? '';
    for (const feature of ['camera', 'geolocation', 'microphone', 'payment']) {
      expect(pp).toContain(`${feature}=()`);
    }
  });

  it('CSP header is present and contains expected directives', async () => {
    const res = await makeApp().request('/');
    // In NODE_ENV=test, report-only mode is used
    const csp =
      res.headers.get('Content-Security-Policy-Report-Only') ??
      res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('https://api.openrouter.ai');
  });

  it('uses Content-Security-Policy-Report-Only in test/dev (NODE_ENV=test)', async () => {
    // NODE_ENV is 'test' in this suite — middleware should use report-only mode
    const res = await makeApp().request('/');
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeTruthy();
    // Strict CSP header must NOT be present simultaneously
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('uses enforcing CSP when cspReportOnly is explicitly false', async () => {
    const res = await makeApp({ cspReportOnly: false }).request('/');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeNull();
  });

  it('includes extra script hashes in CSP script-src when provided', async () => {
    const hash = 'sha256-abc123=';
    const res = await makeApp({ cspScriptHashes: [hash] }).request('/');
    const csp =
      res.headers.get('Content-Security-Policy-Report-Only') ??
      res.headers.get('Content-Security-Policy') ??
      '';
    expect(csp).toContain(hash);
  });

  it('includes extra connect-src origins when provided', async () => {
    const extra = 'https://extra.example.com';
    const res = await makeApp({ connectSrcExtra: [extra] }).request('/');
    const csp =
      res.headers.get('Content-Security-Policy-Report-Only') ??
      res.headers.get('Content-Security-Policy') ??
      '';
    expect(csp).toContain(extra);
  });
});
