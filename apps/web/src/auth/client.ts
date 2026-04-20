import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// better-auth constructs `new URL(baseURL)` which requires an absolute URL.
// Use the current origin so same-origin relative fetches still work and
// dev/prod both resolve to the correct host. The /api/auth prefix is
// mounted on the API (proxied by the web dev server + serve.ts in prod).
const baseURL =
  typeof window !== 'undefined'
    ? `${window.location.origin}/api/auth`
    : 'http://localhost:3000/api/auth';

export const authClient = createAuthClient({
  baseURL,
  plugins: [twoFactorClient()],
});
