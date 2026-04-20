import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
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
import { onError } from './error';

const env = loadEnv();

export const app = new Hono();

app.use('*', requestId());
app.use('*', cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.onError(onError);

// Lockout middleware wraps better-auth sign-in to check/record lockout
app.use('/api/auth/*', lockoutMiddleware);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/healthz', (c) => c.json({ status: 'ok' }));

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
