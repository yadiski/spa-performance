import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { aiRoutes } from '../ai/routes';
import { auditRoutes } from '../audit/routes';
import { authAdminRoutes } from '../auth/admin-routes';
import { auth } from '../auth/better-auth';
import { impersonationRoutes } from '../auth/impersonation-routes';
import { lockoutMiddleware } from '../auth/lockout-middleware';
import { mfaRecoveryRoutes } from '../auth/mfa-recovery-routes';
import { requireAuth } from '../auth/middleware';
import { adminSessionRoutes, sessionRoutes } from '../auth/session-routes';
import { dashboardRoutes } from '../dashboards/routes';
import { cycleRoutes } from '../domain/cycle/routes';
import { kraRoutes } from '../domain/kra/routes';
import { midYearRoutes } from '../domain/mid-year/routes';
import { notificationRoutes } from '../domain/notifications/routes';
import { pmsRoutes } from '../domain/pms/routes';
import { staffRoutes } from '../domain/staff/routes';
import { loadEnv } from '../env';
import { exportRoutes } from '../exports/routes';
import { searchRoutes } from '../search/routes';
import { isConfigured as r2IsConfigured } from '../storage/r2';
import { corsMiddleware } from './cors';
import { onError } from './error';
import { forceHttps } from './force-https';
import { authIpRateLimit, mutatingRateLimit } from './rate-limit';
import { requestIdMiddleware } from './request-id';
import { securityHeaders } from './security-headers';

const env = loadEnv();
void env; // used for side-effect validation only; individual modules read process.env directly

export const app = new Hono();

// ── Middleware chain (order matters) ─────────────────────────────────────────

// 1. TLS enforcement — redirect http → https in production
app.use('*', forceHttps());

// 2. Request ID for traceability + structured request logging
app.use('*', requestIdMiddleware);

// 3. CORS — strict allowlist replacing the former wildcard
app.use('*', corsMiddleware);

// 4. Security headers — HSTS, CSP, X-Frame-Options, etc.
app.use('*', securityHeaders());

app.onError(onError);

// ── Auth routes ───────────────────────────────────────────────────────────────
// Rate-limit: 10 req/min/IP on all auth paths
app.use('/api/auth/*', authIpRateLimit());
// Lockout check wraps better-auth sign-in
app.use('/api/auth/*', lockoutMiddleware);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/healthz', (c) => c.json({ status: 'ok' }));

app.get('/api/v1/healthz/deep', async (c) => {
  const token = c.req.header('x-health-token');
  if (!token || token !== process.env.HEALTH_CHECK_TOKEN) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  // Check DB connectivity
  let dbStatus = 'ok';
  try {
    const { db } = await import('../db/client');
    await db.execute(sql`select 1`);
  } catch {
    dbStatus = 'error';
  }

  return c.json({
    db: dbStatus,
    r2: r2IsConfigured() ? 'ok' : 'unconfigured',
    timestamp: new Date().toISOString(),
  });
});

// ── Authenticated API ─────────────────────────────────────────────────────────
// Mutating rate-limit: 60 POST/PATCH/PUT/DELETE per minute per user
app.use('/api/v1/*', mutatingRateLimit());

app.get('/api/v1/me', requireAuth, (c) => c.json({ actor: c.get('actor') }));

app.route('/api/v1/kra', kraRoutes);
app.route('/api/v1/cycle', cycleRoutes);
app.route('/api/v1/staff', staffRoutes);
app.route('/api/v1/mid-year', midYearRoutes);
app.route('/api/v1/pms', pmsRoutes);
app.route('/api/v1/notifications', notificationRoutes);
app.route('/api/v1/ai', aiRoutes);
app.route('/api/v1/dashboards', dashboardRoutes);
app.route('/api/v1/search', searchRoutes);
app.route('/api/v1/exports', exportRoutes);
app.route('/api/v1/admin/audit', auditRoutes);
// Phase 4 — access control hardening
app.route('/api/v1/auth', sessionRoutes);
app.route('/api/v1/auth', mfaRecoveryRoutes);
app.route('/api/v1/admin/auth', authAdminRoutes);
app.route('/api/v1/admin/auth', adminSessionRoutes);
app.route('/api/v1/admin/impersonation', impersonationRoutes);
