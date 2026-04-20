# Incident Response Runbook

**Date:** 2026-04-20  
**Owner:** IT Admin / Engineering  

---

## 1. Database Down

**Symptoms:** `/api/v1/healthz/deep` returns `{"db":"error"}`. All API endpoints return 500. Logs show `ECONNREFUSED` or `connection refused` from postgres-js.

**Immediate checks:**
1. Open Railway dashboard → database service → check status and recent logs.
2. Verify the `DATABASE_URL` env var is correct and the database service is running.
3. Check Railway's status page (status.railway.app) for platform-wide outages.

**Mitigation:**
- If the DB service is crashed: restart it from Railway dashboard.
- If env var was accidentally changed: revert to the previous value and redeploy.
- If disk is full (Railway volume): expand the volume size in settings.

**Escalation:** If DB is unrecoverable, contact Railway support with the service ID. Retain the last DB backup (Railway auto-snapshots daily).

---

## 2. Worker Stuck or Not Consuming Jobs

**Symptoms:** Emails not sent, PDFs not generated, retention jobs haven't run. pg-boss queue shows growing job backlog.

**Immediate checks:**
1. In Railway, check the worker service logs (`bun src/worker.ts`) for errors.
2. Query the pg-boss queue table directly:
   ```sql
   select name, state, count(*) from pgboss.job group by name, state order by name, state;
   ```
3. Look for jobs in `failed` or `expired` state — the error column shows the cause.

**Mitigation:**
- Restart the worker service in Railway dashboard.
- If a specific job type is repeatedly failing, check its error, fix the underlying issue, then retry failed jobs:
  ```sql
  update pgboss.job set state = 'retry' where state = 'failed' and name = '<queue-name>';
  ```
- If pg-boss itself is stuck (no worker is polling), `truncate pgboss.schedule` and restart.

**Escalation:** If the worker cannot start, check for TypeScript/import errors in deploy logs.

---

## 3. Email Bounces / Send-Email Job Repeatedly Failing

**Symptoms:** `notifications.send_email` jobs in `failed` state. Users not receiving password resets, audit alerts, or export-ready notifications.

**Immediate checks:**
1. Open Resend dashboard (https://resend.com) → Logs → filter by recent failures.
2. Check the bounce reason: hard bounce (invalid address) vs soft bounce (mailbox full).
3. Verify `RESEND_API_KEY` and `RESEND_FROM_EMAIL` env vars are set and correct.

**Mitigation:**
- If API key is expired: generate a new key in Resend dashboard and update the env var.
- If the sending domain is not verified: verify the domain DNS records in Resend.
- If a specific address is bouncing: check Resend's suppression list and remove if needed.
- Re-queue failed email jobs after fixing the root cause (see worker section above).

**Escalation:** Check Resend's status page for service-wide issues before investigating local config.

---

## 4. Audit Chain Break

**Symptoms:** The `audit.anchor_alert` job sends an alert email. `/api/v1/admin/audit/verify` returns `ok: false`. The daily anchor row is missing or the chain hash doesn't match.

**Immediate checks:**
1. Check which audit_log id failed verification:
   ```sql
   select id, ts, event_type, prev_hash, hash from audit_log order by id desc limit 20;
   ```
2. Determine if a row was deleted (only permitted via the archive flow with `set local app.audit_archive = 'yes'`).
3. Check whether the anchor row for yesterday exists:
   ```sql
   select * from audit_anchor where date = current_date - 1;
   ```

**Mitigation:**
- If an anchor row is missing but the chain is intact: re-run the daily anchor job manually by queuing a job to `audit.anchor.daily`.
- If rows were deleted outside the archive flow: this is a security incident — escalate immediately and preserve a dump of the affected table range.
- Chain breaks cannot be "repaired" without invalidating the audit trail. Document the gap in a legal-hold note.

**Escalation:** Any chain break that cannot be explained by the archive flow is a potential data integrity or security incident. Notify the HRA and legal counsel.

---

## 5. Rate Limit False Positives

**Symptoms:** Legitimate users receive 429 errors. The error response includes `X-Request-Id`; check logs for that ID.

**Immediate checks:**
1. Identify the bucket key being throttled:
   ```sql
   select bucket_key, requests, last_at from http_rate_limit
   where last_at > now() - interval '10 minutes'
   order by requests desc limit 20;
   ```
2. Determine if the high request rate is legitimate (e.g. an integration, a batch operation) or an attack.

**Mitigation:**
- Temporarily unlock a specific bucket by deleting its row:
  ```sql
  delete from http_rate_limit where bucket_key = '<user_id>:mutating';
  ```
- If the rate limit threshold is consistently too low for a power user, adjust the limit in `rate-limit.ts` and redeploy.
- If it looks like an attack (many different IPs hitting auth endpoints): consider blocking the IP range at the Railway/CDN level.

**Escalation:** If systematic abuse is detected, lock the account via the admin session routes and notify the HRA.

---

## 6. AI Budget Exhausted Unexpectedly

**Symptoms:** AI features return errors. Logs show `ai.budget.exceeded` events. Users see "AI features unavailable" messages.

**Immediate checks:**
1. Check the current spend in `ai_usage_daily`:
   ```sql
   select org_id, date, prompt_tokens + completion_tokens as total_tokens, requests
   from ai_usage_daily
   where date >= current_date - 7
   order by date desc, total_tokens desc;
   ```
2. Identify which features consumed the most via audit_log:
   ```sql
   select payload->>'feature' as feature, count(*) from audit_log
   where event_type like 'ai.%' and ts > now() - interval '24 hours'
   group by 1 order by 2 desc;
   ```

**Mitigation:**
- If an org hit the daily budget: the budget resets at midnight UTC — communicate the timeline to users.
- If the budget constant is too low for legitimate usage, increase `AI_DAILY_BUDGET_USD` in env vars.
- If a specific feature is over-consuming, check for prompt injection or unusual usage patterns and disable that feature temporarily.

**Escalation:** If OpenRouter charges are unexpectedly high, check the OpenRouter dashboard for unusual API activity and rotate the `OPENROUTER_API_KEY`.

---

## 7. 500 Errors with Mysterious Source

**Symptoms:** Users report errors; the error response body contains a `requestId`. You need to find the root cause.

**Step-by-step:**
1. Extract the `requestId` from the error response (field: `requestId`).
2. Search structured logs for that request ID:
   ```bash
   # If logs are streamed to a file:
   grep '"requestId":"<id>"' /var/log/app.log
   
   # In Railway: use the log search UI with the exact requestId value
   ```
3. The `http.request` log line shows method, path, status, and duration.
4. The error client (stderr) emits a JSON line with the full stack trace:
   ```bash
   grep '"requestId":"<id>"' /var/log/app.err
   ```
5. Cross-reference with `audit_log.request_id` to see what mutations happened during that request:
   ```sql
   select ts, event_type, actor_id, target_type, target_id, payload
   from audit_log
   where request_id = '<id>'
   order by id asc;
   ```

**Escalation:** If the stack trace points to a data corruption issue (unexpected null, FK violation), freeze writes to the affected table and investigate before re-enabling traffic.
