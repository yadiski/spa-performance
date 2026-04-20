# Uptime Probe — Configuration & Alert Guide

**Date:** 2026-04-20  
**Owner:** IT Admin  

---

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /healthz` | None | Shallow liveness check — always returns `{"status":"ok"}` if the process is up |
| `GET /api/v1/healthz/deep` | `X-Health-Token: <HEALTH_CHECK_TOKEN>` | Deep health check — pings DB and verifies R2 configuration |

---

## Recommended External Monitors

### UptimeRobot (free tier, recommended for low-cost setups)
1. Create account at https://uptimerobot.com
2. Add monitor → HTTP(s)
3. URL: `https://<your-domain>/healthz`
4. Interval: **60 seconds**
5. Alert contacts: email to HRA + IT Admin
6. Fail threshold: alert after **3 consecutive failures** (default)

### Pingdom / Better Uptime (paid, more features)
- Same configuration; use their keyword check to verify `"status":"ok"` in the body.

### Railway native healthcheck
- In `railway.json` or service settings, set `healthcheckPath: /healthz` and `healthcheckTimeout: 5`.
- Railway will restart the service on repeated failures.

---

## Alert Configuration

- **Interval:** 60 seconds
- **Alert after:** 3 consecutive failures (3 minutes of downtime before alert fires)
- **Channels:**
  - Email to HRA and IT Admin (at minimum)
  - Optional: Slack webhook for #infra-alerts channel

---

## Deep Health Check (`/api/v1/healthz/deep`)

This endpoint requires the `X-Health-Token` header matching the `HEALTH_CHECK_TOKEN` env var.

**Sample response (healthy):**
```json
{
  "db": "ok",
  "r2": "ok",
  "timestamp": "2026-04-20T12:00:00.000Z"
}
```

**Sample response (R2 unconfigured):**
```json
{
  "db": "ok",
  "r2": "unconfigured",
  "timestamp": "2026-04-20T12:00:00.000Z"
}
```

Configure a secondary monitor (e.g. Pingdom) to hit this endpoint with the token header every 5 minutes as a deeper availability check.

---

## What to Check Besides HTTP 200

If `/healthz` returns non-200 or times out:

1. **Check Railway deploy logs** — look for crash loops or OOM kills.
2. **Run deep check manually:**
   ```bash
   curl -H "X-Health-Token: $HEALTH_CHECK_TOKEN" https://<domain>/api/v1/healthz/deep
   ```
3. **If `db: "error"`** → see the Database Down runbook in `incident-response.md`.
4. **If process is not responding** → Railway restart via dashboard or `railway restart`.
5. **Check pg-boss worker** — a crashed worker does not affect `/healthz`, but audit jobs stop.

---

## Escalation

| Condition | Action |
|---|---|
| 3 failures | Email alert fires automatically |
| 10+ failures (10 min) | Page IT Admin directly |
| Database down | Follow Database Down section in `incident-response.md` |
| Still unresolved after 30 min | Escalate to Engineering lead |
