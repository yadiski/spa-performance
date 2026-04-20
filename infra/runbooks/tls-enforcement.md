# TLS Enforcement Runbook

## Overview

Transport Layer Security is enforced at two layers:

1. **Railway edge gateway** — terminates TLS (1.2+, 1.3 preferred) before
   requests reach the application container. All traffic from Railway's public
   load balancer to the app arrives over an internal network and is tagged with
   `X-Forwarded-Proto: https`.
2. **Application guard** (`apps/api/src/http/force-https.ts`) — if a request
   somehow arrives with `X-Forwarded-Proto: http` in production, the middleware
   issues a `301` redirect to the `https://` equivalent.

## Verifying Railway's TLS setup

### 1. DNS lookup

```sh
nslookup <your-production-domain>
# Confirm the A/CNAME record points to Railway's edge IP.
```

### 2. Cipher enumeration with nmap

```sh
nmap --script ssl-enum-ciphers -p 443 <your-production-domain>
```

Look for:
- `TLSv1.3` listed as a supported protocol.
- `TLSv1.0` and `TLSv1.1` absent (Railway disables them by default).

### 3. Browser DevTools

Open the Security panel in Chrome DevTools → confirm "TLS 1.3" and a valid
certificate issued by Let's Encrypt (Railway's auto-renewal provider).

### 4. OpenSSL one-liner

```sh
openssl s_client -connect <your-production-domain>:443 -tls1_3 </dev/null 2>&1 | grep 'Protocol'
# Expected output: Protocol  : TLSv1.3
```

## Railway certificate auto-renewal

Railway provisions Let's Encrypt certificates automatically for custom domains.
Certificates are renewed before expiry without manual intervention.

Reference: https://docs.railway.com/guides/custom-domains

## HSTS preload submission

Once the production domain is stable and the HSTS policy has been served in
enforcing mode for at least 60 days, submit to the HSTS preload list:

1. Confirm the `Strict-Transport-Security` header includes `preload`:
   ```
   Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
   ```
2. Visit https://hstspreload.org and submit the production domain.
3. Monitor the submission status — inclusion in Chrome's preload list takes
   several weeks after acceptance.

**Important:** Do NOT submit to the preload list until you are certain the
production domain will remain HTTPS-only permanently. Removal from the preload
list is slow and cannot be done instantly.

## Application-level HTTP→HTTPS redirect

The `forceHttps` middleware in `apps/api/src/http/force-https.ts` is activated
only when `NODE_ENV === 'production'`. It checks `X-Forwarded-Proto` and issues
a `301` redirect if it equals `http`.

This is a defence-in-depth measure — Railway should never forward plain HTTP,
but the guard ensures correctness even if the proxy configuration changes.
