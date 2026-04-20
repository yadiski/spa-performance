/**
 * T12 — Security headers middleware
 *
 * CSP trade-off note:
 * ──────────────────
 * Vite in production mode (build) emits all scripts and styles as external
 * files (JS chunks + CSS files), so `'unsafe-inline'` is NOT required for
 * script-src or style-src as long as `build.cssCodeSplit` and `build.inlineDynamicImports`
 * are NOT set to force inlining. The default Vite config in this repo
 * (`apps/web/vite.config.ts`) does NOT force inlining, so we can ship a
 * strict CSP (`'self'` only, no `'unsafe-inline'`).
 *
 * If ops ever discovers CSP violations (e.g. from third-party injections or
 * new Vite plugins that emit inline scripts), the recommended ramp-up path is:
 *   1. Switch `cspReportOnly: true` temporarily.
 *   2. Collect violation reports via the `report-uri` directive (add a
 *      `/api/v1/csp-report` endpoint or an external service).
 *   3. Hash any unavoidable inline scripts and pass them via `cspScriptHashes`.
 *
 * See `infra/runbooks/csp-hardening.md` for the full operational guide.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';

export interface SecurityHeaderOptions {
  /** Default: true when NODE_ENV !== 'production' */
  cspReportOnly?: boolean;
  /** sha256-<base64> tokens for known inline scripts */
  cspScriptHashes?: string[];
  /** sha256-<base64> tokens for known inline styles */
  cspStyleHashes?: string[];
  /** Additional allowed origins for connect-src */
  connectSrcExtra?: string[];
}

function buildCsp(opts: SecurityHeaderOptions): string {
  const scriptSrc = ["'self'", ...(opts.cspScriptHashes ?? [])].join(' ');
  const styleSrc = ["'self'", ...(opts.cspStyleHashes ?? [])].join(' ');
  const connectSrc = [
    "'self'",
    'https://api.openrouter.ai',
    'https://api.resend.com',
    ...(opts.connectSrcExtra ?? []),
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function securityHeaders(opts?: SecurityHeaderOptions): MiddlewareHandler {
  const isProduction = process.env.NODE_ENV === 'production';
  const options: SecurityHeaderOptions = opts ?? {};

  const reportOnly = options.cspReportOnly ?? !isProduction;
  const cspHeaderName = reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  const cspValue = buildCsp(options);

  return async (c: Context, next: Next) => {
    await next();

    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.set(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    );
    c.res.headers.set(cspHeaderName, cspValue);
  };
}
