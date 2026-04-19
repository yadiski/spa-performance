import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { cors } from 'hono/cors';
import { onError } from './error';
import { loadEnv } from '../env';

const env = loadEnv();

export const app = new Hono();

app.use('*', requestId());
app.use('*', cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.onError(onError);

app.get('/healthz', (c) => c.json({ status: 'ok' }));
