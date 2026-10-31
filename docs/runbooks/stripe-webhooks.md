# Stripe webhook failures and replay

The webhook (`POST /api/v1/webhooks/stripe`) is the **only** path that marks an order PAID. Events handled: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` (+ `charge.dispute.created` subscribed for alerting). Processing is idempotent: each Stripe event id is stored in `ProcessedWebhook`, so a replayed event that already succeeded is a no-op (`{received:true, duplicate:true}`).

## Symptoms

- Alerts B1/B2/B3 ([monitoring.md](monitoring.md)); Stripe email "webhook endpoint failing".
- Customers charged, order still `PENDING_PAYMENT` → later auto-cancelled by the reservation job.
- Stripe Dashboard → Developers → Webhooks → endpoint → many non-2xx deliveries.

## Diagnose (by response Stripe recorded)

| Stripe sees                 | Likely cause                                                                                                                     | Fix                                                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 Invalid signature`     | `STRIPE_WEBHOOK_SECRET` doesn't match this endpoint (rotated in Stripe but not Render, staging secret in prod, or two endpoints) | Copy the endpoint's signing secret into `hp-api-secrets` → redeploy `hp-api`. During rotation Stripe can sign with both old and new secrets for up to 24 h ("Roll secret" with expiry) — use that. |
| `400 Invalid payload` / 413 | Body modified or > 1 MB (a proxy/WAF rule rewriting bodies)                                                                      | Ensure Cloudflare has no transform/WAF challenge on `/api/v1/webhooks/*` ([edge-security.md](edge-security.md)).                                                                                   |
| `403`/challenge HTML        | Cloudflare WAF, bot fight mode or rate limit blocked Stripe                                                                      | Add the skip rule for `/api/v1/webhooks/stripe` (edge-security.md).                                                                                                                                |
| `5xx` / timeout             | API down, DB down, or handler bug                                                                                                | Health check, Sentry `hp-api` (tag `area: payment`), Render logs. Roll back if release-related.                                                                                                    |
| No deliveries at all        | Endpoint disabled by Stripe after days of failures, wrong URL, or wrong mode (test vs live)                                      | Re-enable endpoint; confirm URL `https://api.hearthandpan.com/api/v1/webhooks/stripe` in **live** mode.                                                                                            |

## Replay

Fix the cause first, then:

1. **Automatic**: Stripe retries failed deliveries with backoff for up to 3 days (live mode). Once the endpoint returns 2xx, the backlog drains by itself — usually you only need to watch.
2. **Manual, single event**: Dashboard → Webhooks → endpoint → failed event → **Resend**.
3. **Bulk, by time window** (Stripe CLI, from an operator machine logged in with a restricted key):
   ```bash
   # list failed-delivery events since the incident start, then resend each to the prod endpoint
   stripe events list --limit 100 --created.gte <unix-ts> --type payment_intent.succeeded
   stripe events resend <evt_id> --webhook-endpoint <we_id>
   ```
   Replays are safe because of `ProcessedWebhook` idempotency.

**Know before replaying:** if the reservation job already cancelled the order, a late `payment_intent.succeeded` **automatically refunds** the payment (order event `payment_after_cancellation`). That's intended (the stock may be gone). If the business would rather honour these orders, contact the customer first and recreate the order manually instead of replaying — decide before step 3.

## Verify

```sql
-- PaymentIntents that Stripe says succeeded must not stay PENDING_PAYMENT
SELECT number, status, "stripePaymentIntentId", "createdAt"
FROM "Order" WHERE status = 'PENDING_PAYMENT' AND "createdAt" > now() - interval '1 day'
ORDER BY "createdAt";
-- Orders auto-refunded because payment arrived after cancellation
SELECT o.number, e."createdAt" FROM "OrderEvent" e JOIN "Order" o ON o.id = e."orderId"
WHERE e.type = 'payment_after_cancellation' AND e."createdAt" > now() - interval '3 days';
```

Cross-check against Stripe → Payments filtered to "Succeeded" in the same window. Email affected customers (template in the incident doc) once reconciled.
