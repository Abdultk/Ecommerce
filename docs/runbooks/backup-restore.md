# Backup and restore

## Targets

|                               | Target                                                   | How it is met                                                                                                                               |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (max data loss)       | **≤ 5 minutes** for infrastructure failure or bad writes | Render Postgres point-in-time recovery (continuous WAL archiving) on a paid plan                                                            |
|                               | ≤ 24 h worst case                                        | Render daily snapshots, if PITR is unavailable                                                                                              |
| **RTO** (time to serve again) | **≤ 60 minutes** at launch data size                     | PITR restore into a new instance (~10–30 min at < 10 GB, per Render) + repoint `DATABASE_URL` + redeploy (~10 min) + verification (~10 min) |

Stripe is the source of truth for payments: after any restore, reconcile payments made after the recovery point ([stripe-webhooks.md](stripe-webhooks.md) → replay events).

## Scripts (local / docker)

| Script                                                                  | What it does                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `infra/scripts/backup.sh [--db hearthandpan] [--out DIR]`               | `pg_dump --format=custom` via `docker exec` into the hearth-and-pan Postgres container; writes `infra/backups/<db>_<UTC>.dump`, `.sha256` and `.counts` (rows per table). Read-only on the source. `infra/backups/` is git-ignored.                                                                                      |
| `infra/scripts/restore-drill.sh [--dump FILE] [--keep] [--skip-prisma]` | Takes a backup (unless `--dump`), checks the checksum, creates **new** DB `hearthandpan_restore_drill`, `pg_restore --exit-on-error --jobs=4`, compares per-table row counts to the backup manifest and the live source, runs `prisma migrate status` against the scratch DB, prints timings, then drops the scratch DB. |

Safety rails: the scratch name must end in `_restore_drill` and can never be `hearthandpan`, `hearthandpan_test`, `hearthandpan_e2e_test` or a system DB; an existing scratch DB is only replaced with `--replace-existing <exact name>`; only containers named `hearth-and-pan-*` are touched; the source is only read (`pg_dump`, `SELECT count(*)`).

## Drill record — 2026-10-11 (local dev, Phase 3 / Gate G4)

Environment: Windows 11, Git Bash, Docker Desktop, `hearth-and-pan-postgres-1` (postgres:16-alpine), source `hearthandpan` (seeded dev catalog).

Command: `bash infra/scripts/restore-drill.sh` → **PASSED** (three full runs plus one `--dump` re-run all passed; the scratch DB was dropped each time).

| Table                                                                                                                                                   | Backup | Restored | Source |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------ |
| Category                                                                                                                                                | 13     | 13       | 13     |
| Coupon                                                                                                                                                  | 1      | 1        | 1      |
| Product                                                                                                                                                 | 8      | 8        | 8      |
| ProductImage                                                                                                                                            | 8      | 8        | 8      |
| ProductVariant                                                                                                                                          | 11     | 11       | 11     |
| StockMovement                                                                                                                                           | 9      | 9        | 9      |
| User                                                                                                                                                    | 1      | 1        | 1      |
| `_prisma_migrations`                                                                                                                                    | 2      | 2        | 2      |
| Address, AuditLog, Cart, CartItem, Order, OrderEvent, OrderItem, OrderSequence, ProcessedWebhook, RefreshToken, Refund, Review, UserToken, WishlistItem | 0      | 0        | 0      |

22/22 tables matched. `prisma migrate status` on the restored DB: **up to date** (2 migrations).

| Step                                     | Run 1      | Run 2 (`--dump`) | Run 3 (final) |
| ---------------------------------------- | ---------- | ---------------- | ------------- |
| Backup (pg_dump + copy + verify archive) | 16.8 s     | —                | 7.9 s         |
| pg_restore                               | 2.3 s      | 1.5 s            | 1.4 s         |
| Row-count verification                   | 2.1 s      | 1.4 s            | 18.1 s*       |
| `prisma migrate status`                  | 30.9 s     | 31.4 s           | 52.9 s        |
| **Total**                                | **54.5 s** | **38.8 s**       | **82.4 s**    |

Dump size 52,529 bytes. *Timings are dominated by per-process overhead on Windows (docker exec, pnpm/Prisma start-up), not data volume; the dev DB has no orders yet, so these numbers say nothing about production RTO. The staging drill below is the one that measures RTO.

Findings: none blocking. Fixed during the drill: (1) `docker exec -i` inside a read loop swallowed stdin (only the first table was counted) — counts now run as one query; (2) Git Bash path conversion broke `docker cp`/`docker compose -f` and the pnpm shim — host paths are converted with `cygpath`, and Prisma runs without `MSYS_NO_PATHCONV`.

## Production procedure (Render Postgres)

Prerequisites (Phase 4): `hp-db` on a paid plan with PITR enabled; confirm the recovery window in the dashboard (Render offers 3 or 7 days depending on workspace plan) and record it here: `____ days`.

### A. Point-in-time recovery (bad deploy/data corruption/accidental delete)

1. Declare an incident ([incident-response.md](incident-response.md)). Decide the recovery timestamp (UTC) — just before the bad write (use `AuditLog.createdAt`, deploy time, or Sentry first-seen).
2. Put the storefront into maintenance if writes would make things worse: scale `hp-worker` to 0 and set the Cloudflare maintenance rule (custom page for `www.` checkout paths). Keep the API up if reads are fine.
3. Render → `hp-db` → **Recovery** → **Restore to a point in time** → choose timestamp. Render creates a **new** database instance (e.g. `hp-db-restored-<date>`); the original is untouched.
4. Verify the new instance (from the Render shell of `hp-api`, with `DATABASE_URL` pointing at the new instance for that one command):
   - `npx prisma migrate status` → up to date.
   - Row counts of `Order`, `OrderItem`, `ProductVariant`, `StockMovement`, `User`, `Refund` vs expectations (query in "Verification SQL").
   - Spot-check the last orders before the recovery point.
5. Cut over: update `DATABASE_URL` on `hp-api` and `hp-worker` (replace the `fromDatabase` reference in `render.yaml` with the new DB name and sync the blueprint, or set it in the dashboard), redeploy both, scale worker back to 1.
6. Reconcile Stripe: list PaymentIntents/refunds created after the recovery point and replay their webhook events ([stripe-webhooks.md](stripe-webhooks.md)). Re-send order confirmation emails if needed.
7. Keep the old instance (read-only, for forensics) for 7 days, then delete it. Record actual RTO/RPO in the incident doc.

### B. Daily backup / logical export

Render → `hp-db` → **Backups**: download the daily logical export for archival or for restoring into a different environment. To restore elsewhere: `pg_restore --no-owner --no-privileges --exit-on-error -d <new-empty-db> <file>` then run the verification below.

### C. Total loss of the Render region

Create a new Blueprint in another region, restore the latest exported backup (RPO ≤ 24 h), update DNS CNAME for `api.` in Cloudflare, and reconcile from Stripe.

## Staging rehearsal (monthly, and before Gate G4 sign-off on staging)

1. Note the time `T` and record row counts on staging `hp-db` (Verification SQL).
2. Render → staging `hp-db` → Recovery → restore to `T` into a new instance. Time it.
3. Run the verification SQL and `prisma migrate status` against the restored instance; counts must equal the snapshot at `T`.
4. Point a staging `hp-api` preview (or the staging API for 15 min) at it; run `infra/scripts/smoke.sh <api> <web>` or `curl /api/v1/health` + a product listing.
5. Record: start/end times (= measured RTO), recovery point vs `T` (= measured RPO), problems. Delete the restored instance.

## Verification SQL

```sql
SELECT 'Order' t, count(*) FROM "Order" UNION ALL
SELECT 'OrderItem', count(*) FROM "OrderItem" UNION ALL
SELECT 'Refund', count(*) FROM "Refund" UNION ALL
SELECT 'ProductVariant', count(*) FROM "ProductVariant" UNION ALL
SELECT 'StockMovement', count(*) FROM "StockMovement" UNION ALL
SELECT 'User', count(*) FROM "User" UNION ALL
SELECT 'ProcessedWebhook', count(*) FROM "ProcessedWebhook" UNION ALL
SELECT '_prisma_migrations', count(*) FROM "_prisma_migrations";
-- Ledger invariant: stock movements sum to stockOnHand for every variant (expect 0 rows)
SELECT v.sku, v."stockOnHand", coalesce(sum(m.delta), 0) AS ledger
FROM "ProductVariant" v LEFT JOIN "StockMovement" m ON m."variantId" = v.id
GROUP BY v.id HAVING v."stockOnHand" <> coalesce(sum(m.delta), 0);
```
