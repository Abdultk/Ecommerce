# Stuck stock reservations

Checkout reserves stock (`ProductVariant.stockReserved += qty`) and creates a `PENDING_PAYMENT` order with `reservationExpiresAt` = now + `RESERVATION_TTL_MINUTES` (15). The worker's `release-expired-reservations` job runs every minute: it cancels lapsed `PENDING_PAYMENT` orders, returns the stock and cancels the PaymentIntent. Available stock = `stockOnHand − stockReserved`.

## Symptoms

- Products show out of stock while the warehouse has them; admin inventory shows high "reserved".
- Alert B3/B4/A8 ([monitoring.md](monitoring.md)).

## 1. Is the job running?

- Sentry Cron `release-expired-reservations` check-ins; Render `hp-worker` status and logs (`released expired reservations`, `job failed`).
- Worker needs Redis: check `hp-redis` memory (A10). With `noeviction`, a full Redis rejects new jobs.
- Fix: restart `hp-worker` (Render → Manual Deploy → "Restart service"). Repeatable jobs are re-registered on start without duplicates. Within 1–2 minutes the backlog is processed in batches.

## 2. Measure

```sql
-- Overdue pending orders (should be ~0 within 2 minutes of expiry)
SELECT count(*), min("reservationExpiresAt") FROM "Order"
WHERE status = 'PENDING_PAYMENT' AND "reservationExpiresAt" < now();

-- Drift: reserved stock that no open checkout accounts for (expect 0 rows)
SELECT v.sku, v."stockReserved", coalesce(p.held, 0) AS held_by_pending_orders
FROM "ProductVariant" v
LEFT JOIN (
  SELECT i."variantId", sum(i.quantity) AS held
  FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
  WHERE o.status = 'PENDING_PAYMENT'
  GROUP BY i."variantId"
) p ON p."variantId" = v.id
WHERE v."stockReserved" <> coalesce(p.held, 0);
```

## 3. Fix

- **Overdue orders, job healthy again**: nothing to do — the job releases them. Watch the count go to 0.
- **Single order needs releasing now** (customer complaint): admin → Orders → the order → **Cancel** (`POST /admin/orders/:id/cancel`) — releases stock, cancels the PaymentIntent, writes an audit entry.
- **Drift without matching pending orders** (bug or a manual DB edit): do **not** hand-edit `stockReserved` in production without a second engineer. Procedure: put the drift query output in the incident doc → confirm no checkout is in flight for those SKUs (`PENDING_PAYMENT` orders = 0 for them) → in one transaction, `SELECT … FOR UPDATE` the variant rows and set `stockReserved` to the pending-order sum → re-run the drift query → file a bug with the evidence. Never touch `stockOnHand` directly; it must equal the `StockMovement` ledger (use admin inventory adjust instead).
- **Payment raced the expiry**: if a payment lands after cancellation it is refunded automatically ([stripe-webhooks.md](stripe-webhooks.md)).
