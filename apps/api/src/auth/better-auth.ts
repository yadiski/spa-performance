import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { loadEnv } from '../env';

const env = loadEnv();

// The web app and the API live on different origins in production (Railway's
// two services get separate *.up.railway.app hosts). better-auth checks the
// Origin header against `trustedOrigins`; without this, the web's POST to
// /api/auth/sign-in/email is rejected as "invalid origin" even though Hono's
// CORS middleware allows it.
const trustedOrigins = [env.WEB_ORIGIN, env.BETTER_AUTH_URL];
if (process.env.ADDITIONAL_CORS_ORIGINS) {
  for (const o of process.env.ADDITIONAL_CORS_ORIGINS.split(',').map((s) => s.trim())) {
    if (o) trustedOrigins.push(o);
  }
}
if (process.env.NODE_ENV !== 'production') {
  trustedOrigins.push('http://localhost:5173', 'http://localhost:3000');
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    autoSignIn: false,
  },
  session: {
    // Absolute expiry: 7 days
    expiresIn: 60 * 60 * 24 * 7,
    // Idle timeout: 8 hours — if no request within this window, session expires
    updateAge: 60 * 60 * 8,
  },
  advanced: { cookiePrefix: 'spa', database: { generateId: 'uuid' } },
  plugins: [twoFactor()],
});

export type Auth = typeof auth;
