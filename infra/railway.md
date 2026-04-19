# Railway deployment

The Railway project `spa-performance` has been created (ID: a29e3dd9-04ab-411a-92cc-24afc7e9c928).
A `Postgres-qBtc` service is already provisioned.

## Services to add (via Railway dashboard)

1. **api** — Source: GitHub repo (or `railway up` from CLI). Dockerfile: `apps/api/Dockerfile`.
   Env vars (inherit DATABASE_URL from Postgres service):
   - `DATABASE_URL` → reference `${{Postgres-qBtc.DATABASE_URL}}`
   - `BETTER_AUTH_SECRET` — generate with `openssl rand -hex 32`
   - `BETTER_AUTH_URL` → public URL of this service
   - `NODE_ENV=production`
   - `API_PORT=3000`
   - `WEB_ORIGIN` → public URL of web service
   Expose port 3000. Healthcheck: `/healthz`.

2. **worker** — Same repo. Dockerfile: `apps/api/Dockerfile.worker`.
   Env vars: `DATABASE_URL` only (inherits from Postgres).

3. **web** — Static site. Build command: `cd apps/web && bun install && bun run build`. Publish dir: `apps/web/dist`.
   Env vars: none at build; runtime handled by reverse proxy rewriting `/api/*` to the `api` service.

## CLI deploy (optional)

From a logged-in CLI:

```bash
railway link  # already done
railway up    # deploys current service
```

Run once per service (switch services with `railway service <name>`).
