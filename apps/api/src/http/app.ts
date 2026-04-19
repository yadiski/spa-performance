import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { auth } from '../auth/better-auth';
import { requireAuth } from '../auth/middleware';
import { cycleRoutes } from '../domain/cycle/routes';
import { kraRoutes } from '../domain/kra/routes';
import { midYearRoutes } from '../domain/mid-year/routes';
import { pmsRoutes } from '../domain/pms/routes';
import { staffRoutes } from '../domain/staff/routes';
import { loadEnv } from '../env';
import { onError } from './error';

const env = loadEnv();

export const app = new Hono();

app.use('*', requestId());
app.use('*', cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.onError(onError);

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/healthz', (c) => c.json({ status: 'ok' }));

app.get('/api/v1/me', requireAuth, (c) => c.json({ actor: c.get('actor') }));

app.route('/api/v1/kra', kraRoutes);
app.route('/api/v1/cycle', cycleRoutes);
app.route('/api/v1/staff', staffRoutes);
app.route('/api/v1/mid-year', midYearRoutes);
app.route('/api/v1/pms', pmsRoutes);
