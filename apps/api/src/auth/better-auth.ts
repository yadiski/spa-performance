import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { loadEnv } from '../env';

const env = loadEnv();

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
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
