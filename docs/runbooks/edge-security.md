# Edge security (Cloudflare)

The zone `hearthandpan.com` uses Cloudflare nameservers.

| Host                         | Points to                             | Proxy                                                   | Why                                                                                                                              |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `api.hearthandpan.com`       | Render `hp-api` custom domain (CNAME) | **Proxied** (orange)                                    | WAF, rate limiting, DDoS in front of the API. Requires `TRUST_PROXY_HOPS=2`.                                                     |
| `www.hearthandpan.com`, apex | Vercel (CNAME / A per Vercel)         | DNS only (grey)                                         | Vercel issues the certificates and runs its own edge. Proxying Vercel is unsupported for cert issuance. Apex redirects to `www`. |
| `admin.hearthandpan.com`     | Vercel `hp-admin`                     | DNS only (or proxied with Cloudflare Access, see below) |                                                                                                                                  |
| `cdn.hearthandpan.com`       | R2 custom domain                      | Proxied (automatic)                                     | Cached image delivery                                                                                                            |

If a Vercel host is ever proxied, the WAF rules below must be extended to it and Vercel's guidance for proxies followed.

## SSL/TLS

- SSL/TLS → Overview: encryption mode **Full (strict)**.
- Edge Certificates: **Minimum TLS Version 1.2**, **TLS 1.3 on**, **Always Use HTTPS on**, **Automatic HTTPS Rewrites on**, **Opportunistic Encryption on**.
- **HSTS** (Edge Certificates → HSTS): enable, `max-age=31536000` (12 months), **includeSubDomains on**, **No-Sniff header on**. Do **not** enable `preload` until every subdomain has served HTTPS cleanly for 30+ days. Preload is effectively irreversible. Ramp-up: start at `max-age=86400` for a week, then raise to a year.
- The API also sends HSTS via helmet; Next apps set their own security headers/CSP (owned by the frontend/backend agents, task 3.5). The edge adds HSTS for the proxied host and does not override app CSP.

## WAF

Security → WAF:

1. **Managed rules**: enable the _Cloudflare Managed Ruleset_ and the _OWASP Core Ruleset_ (paranoia level 1, anomaly threshold "medium") for `api.`. Start the OWASP set in **Log** mode for 7 days, review false positives (especially JSON bodies with HTML in product descriptions on `/api/v1/admin/*`), then switch to **Block**.
2. **Skip rule** (must be first): `http.host eq "api.hearthandpan.com" and http.request.uri.path eq "/api/v1/webhooks/stripe"`. Action: Skip managed rules, rate limiting, Bot Fight Mode and Super Bot Fight Mode. Stripe must never be challenged. The webhook is authenticated by its signature. Optionally also require Stripe's published webhook IP ranges in a separate allow-list rule (keep the list updated from Stripe's docs).
3. **Custom rules**:
   - Block methods other than `GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD` on `api.`.
   - Block `/api/v1/admin/*` requests whose `Origin` header is present and isn't `https://admin.hearthandpan.com` (defence in depth. The API also checks origin and CSRF).
   - Optional: Managed Challenge for `/api/v1/admin/*` from countries the business never operates from.

## Bots

- **Bot Fight Mode: on** (Free/Pro), or Super Bot Fight Mode on Pro+: _Definitely automated → Block_, _Likely automated → Managed Challenge_ for the storefront, **Allow** verified bots (search engines). Exclude the webhook path (skip rule above).
- Bot Fight Mode can't be scoped by path on the Free plan. If it ever challenges the webhook, move to Pro and use Super Bot Fight Mode with the skip rule.

## Rate limiting rules (Security → WAF → Rate limiting rules)

The app also enforces per-IP and per-account limits (`apps/api/src/app.ts` `DEFAULT_LIMITS`). The edge limits are looser outer bounds that stop floods before they reach Render.

| Rule         | Match                                                                             | Threshold                   | Action            | Duration |
| ------------ | --------------------------------------------------------------------------------- | --------------------------- | ----------------- | -------- |
| Auth burst   | `api.` and path starts with `/api/v1/auth/` or `/api/v1/admin/auth/`, method POST | 20 requests / 1 min per IP  | Block             | 10 min   |
| Auth slow    | same                                                                              | 100 requests / 1 h per IP   | Managed Challenge | 1 h      |
| Checkout     | path starts with `/api/v1/checkout/` method POST                                  | 30 requests / 10 min per IP | Block             | 10 min   |
| Order lookup | path `/api/v1/orders/lookup`                                                      | 20 requests / 1 min per IP  | Block             | 10 min   |
| API general  | `api.` any path except the webhook                                                | 600 requests / 1 min per IP | Block             | 1 min    |

Count by IP (`ip.src`). Plan limits apply (Free allows one rule with a 10 s period). The table assumes Pro or Business, so check before Phase 4. Watch Security → Events for a week after launch and tune.

## Optional: Cloudflare Access on admin

Zero Trust → Access → Applications: protect `admin.hearthandpan.com` with an email-OTP or IdP policy for staff. This means proxying `admin.` through Cloudflare. The admin's API calls go to `api.` and stay protected by the app's auth + 2FA.

## Verification after changes

```bash
curl -sI https://api.hearthandpan.com/api/v1/health | grep -i strict-transport-security
curl -s -o /dev/null -w '%{http_code}\n' --tls-max 1.1 https://api.hearthandpan.com/  # expect failure (000)
for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://api.hearthandpan.com/api/v1/auth/login; done  # expect 429 from the app, then a Cloudflare block
```

Then confirm in the Stripe dashboard that a test webhook delivery still returns 2xx.
