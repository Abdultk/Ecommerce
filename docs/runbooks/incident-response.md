# Incident response checklist

## 1. Detect and declare (first 5 minutes)

- [ ] Acknowledge the page (Better Stack / Sentry) so escalation stops.
- [ ] Confirm the impact yourself: storefront home + PDP, add to cart, start checkout (test card on staging; on production, stop at the payment step), admin login, `curl -fsS https://api.hearthandpan.com/api/v1/health`.
- [ ] Set the severity: **SEV1** checkout/payments down, data loss or a security breach. **SEV2** degraded. **SEV3** minor.
- [ ] SEV1/SEV2: open `#hp-incident-<yyyymmdd>-<slug>`, name an **Incident Lead** (decides) and a **Comms** person (updates). For SEV1, page secondary on-call ([on-call.md](on-call.md)).
- [ ] Start the incident doc from the template below. Timestamps in UTC.

## 2. Stabilise (mitigate before you diagnose)

- [ ] Did something just change? Deploy, config, secret, DNS or edge rule. If yes, **roll back** ([deploy-rollback.md](deploy-rollback.md)).
- [ ] Check provider status pages: Render, Vercel, Cloudflare, Stripe, Resend.
- [ ] Use the runbook for the alert: [monitoring.md](monitoring.md) → specific page.
- [ ] If payments can't succeed, consider a storefront banner ("checkout temporarily unavailable") rather than letting customers fail at payment.
- [ ] Security incident (suspected breach, leaked secret, admin account takeover): preserve evidence (don't delete logs), rotate the affected secrets ([secrets-rotation.md](secrets-rotation.md)), revoke sessions (rotating `REFRESH_TOKEN_PEPPER` logs everyone out), disable compromised admin accounts, and involve the business owner about notifying customers or regulators. Never put card data in tickets. Stripe holds card data and we never see full PANs.

## 3. Communicate

- SEV1: update every 30 min in the incident channel, even when there's no news. For customer-visible impact longer than 15 min, post a status/banner.
- Customer emails (charged but no order, auto-refunded orders, lost links) are drafted by Comms and approved by the Incident Lead.

## 4. Resolve and verify

- [ ] Health green, error rate back to baseline for 15 min, one real/test order succeeds end to end (payment → PAID → confirmation email → admin shows it).
- [ ] Reconcile data: [stripe-webhooks.md](stripe-webhooks.md) (payments vs orders) and [stuck-reservations.md](stuck-reservations.md) (stock).
- [ ] Downgrade/close in the channel with a one-line summary.

## 5. Follow up (within 5 working days)

- [ ] Blameless post-incident review covering timeline, impact (orders/revenue/customers), root cause, what went well and what didn't.
- [ ] Action items with owners and dates: alert gaps, runbook fixes, tests.
- [ ] Update this runbook set if any step was wrong or missing.

## Incident doc template

```
Title / SEV / Status
Lead: …   Comms: …   Responders: …
Impact: who/what, start time (UTC), end time, orders affected, revenue at risk
Timeline (UTC): hh:mm — event
Mitigation taken:
Root cause:
Data reconciliation done: payments ☐ stock ☐ emails ☐
Customer communication:
Follow-ups (owner, due):
```
