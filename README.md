# Hearth & Pan

Ecommerce for kitchen goods: customer storefront, admin dashboard and REST API in one pnpm + Turborepo monorepo. The full plan is in [docs/BLUEPRINT.md](docs/BLUEPRINT.md).

## Quick start

Requires Node 22+, pnpm (via `corepack enable`) and Docker.

```bash
bash infra/scripts/bootstrap.sh
```

```bash
pnpm test
```

| Command                        | What it does                             |
| ------------------------------ | ---------------------------------------- |
| `pnpm build`                   | Build every package in dependency order  |
| `pnpm test`                    | Unit tests with coverage gates           |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript across the workspace |
| `pnpm format`                  | Prettier                                 |

Local services (from `infra/docker-compose.yml`): Postgres on 5442, Redis on 6389, Mailpit UI on http://localhost:8035 (ports chosen to avoid clashing with other local stacks; override with HP_POSTGRES_PORT etc.). Add `--profile stripe` to forward Stripe test webhooks.

## Layout

```
apps/api              Express API: auth, admin 2FA, catalog search, cart (Prisma + Postgres)
apps/web              Customer storefront (Next.js 15)
apps/admin            Admin dashboard (Next.js 15)
packages/api-client   Typed fetch client shared by web and admin
packages/contracts    Shared API contract — Zod schemas, types, RBAC, order rules
packages/test-utils   Contract-valid factories, sample catalog, MSW mock API
packages/config       Shared tsconfig, ESLint and Prettier presets
e2e/                  Playwright end-to-end suite, axe scans, k6 load script, ZAP baseline
infra/                docker-compose and scripts
docs/                 Blueprint, decision records and runbooks
```

## Running the apps

```bash
pnpm --filter @hp/api dev
```

```bash
pnpm --filter @hp/web dev
```

```bash
pnpm --filter @hp/admin dev
```

The background worker (email delivery, releasing expired stock reservations every minute, purging expired guest carts hourly) is a second entry point in the API package and needs Redis:

```bash
pnpm --filter @hp/api dev:worker
```

API on http://localhost:4000/api/v1, storefront on :3000, admin on :3001. To run either frontend without the API, set `NEXT_PUBLIC_API_MOCKING=enabled`; mock admin accounts are documented in `apps/admin/src/mocks/accounts.ts` (TOTP code `123456`).

Database scripts read the root `.env`: `pnpm --filter @hp/api db:migrate`, `db:seed` (demo catalog, WELCOME10 coupon, a SUPER_ADMIN for `SEED_ADMIN_EMAIL`, printing a one-time invite link to set the password and 2FA) and `db:studio`. There is deliberately no reset script.

API integration tests use a separate `hearthandpan_test` database, brought up to date with `migrate deploy`. The suite refuses any database whose name doesn't end in `_test`.

```bash
pnpm --filter @hp/api test:int
```

Add `--coverage` (no `--` separator: pnpm 11 passes it through literally) for the coverage gate. Only one run may use `hearthandpan_test` at a time; overlapping runs deadlock on each other's `TRUNCATE`.

## End-to-end tests

Playwright covers the eight critical paths from the blueprint (§8.1), plus axe accessibility scans, a k6 load script and an OWASP ZAP baseline. The suite runs on its own stack: database `hearthandpan_e2e_test`, API on :4100, storefront on :3100 and admin on :3101, all production builds, with email going to the docker-compose Mailpit. It is not part of `pnpm test`.

```bash
pnpm --filter @hp/e2e exec playwright install chromium
```

```bash
pnpm --filter @hp/e2e test:e2e
```

| Command                            | What it does                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @hp/e2e test:e2e`   | Full suite; builds and starts the three servers itself                                                       |
| `pnpm --filter @hp/e2e test:a11y`  | axe scans only                                                                                               |
| `node e2e/scripts/servers.mjs all` | Start the stack by hand (then run tests with `E2E_NO_WEBSERVER=1`; `E2E_SKIP_BUILD=1` reuses the last build) |
| `pnpm --filter @hp/e2e load`       | k6 load test against a running stack (`-e RATE= -e DURATION=`)                                               |
| `pnpm --filter @hp/e2e zap`        | ZAP baseline against a running stack (optionally `web`, `admin` or `api`)                                    |

Settings are in `e2e/.env.e2e.example`; copy it to `e2e/.env.e2e` to override. API secrets are generated per run. Set `E2E_WEBKIT=1` to add the WebKit mobile project.

## Operations

Runbooks live in [docs/runbooks](docs/runbooks/README.md): deploy and rollback, backup and restore, incident response, on-call, monitoring and alerts, secrets rotation, Stripe webhooks, stuck reservations and edge security. Production runs on Render ([render.yaml](render.yaml)): the API, the worker, Postgres and Key Value, with secrets in the `hp-api-secrets` env group.

| Command                                             | What it does                                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `bash infra/scripts/backup.sh`                      | `pg_dump` of the local database plus a checksum and per-table row counts                                                          |
| `bash infra/scripts/restore-drill.sh`               | Restores a fresh backup into `hearthandpan_restore_drill`, checks every table's row count and the migration status, then drops it |
| `bash infra/scripts/smoke.sh <api-base> <web-base>` | Read-only post-deploy smoke test                                                                                                  |

Production backups are Render's managed backups with point-in-time recovery (RPO ≤ 5 minutes, RTO target 60 minutes).

## Using the contract

```ts
import { ProductQuery, can, canTransition, ok, type ProductDetail } from "@hp/contracts";

const query = ProductQuery.parse(req.query); // validated, defaults applied
if (!can(user.role, "order:refund")) {
  /* 403 */
}
canTransition("PAID", "PROCESSING"); // true
```

Money is always integer cents. Every response uses the `{ success, data, error, meta? }` envelope.

## Mock API for frontend work

Until a real endpoint passes its integration tests, the storefront and admin use the MSW mock:

```ts
import { createMockApiHandlers } from "@hp/test-utils/msw";
const handlers = createMockApiHandlers("http://localhost:4000/api/v1");
```

It serves `/products` (search, filters, sort, paging), `/products/:slug`, `/categories`, `/cart` and `POST /cart/items` from an 8-product sample kitchen catalog.

## Build status

| Phase                            | Status                    |
| -------------------------------- | ------------------------- |
| 0 — Foundations                  | Done (Gate G1 signed off) |
| 1 — Core backend + UI shells     | Done (Gate G2 signed off) |
| 2 — Checkout, orders, admin CRUD | Done (Gate G3 signed off) |
| 3 — Analytics, hardening         | Done (awaiting Gate G4)   |
| 4 — Launch                       | Not started               |

### Contract v1 changes from the blueprint

These came out of the Phase 0 code review. They supersede the matching parts of `docs/BLUEPRINT.md`:

- **No `PARTIALLY_REFUNDED` status.** Partial refunds no longer change fulfillment status, so a partly refunded order can still ship. Orders carry `refundedCents` and `refundState` (`NONE` / `PARTIAL` / `FULL`), and a full refund moves the order to `REFUNDED`. Drop the enum value from the Prisma schema.
- **Product endpoints never set stock.** New variants take `initialStock`, which the API records as a RESTOCK movement. Existing variants are patched with `AdminVariantPatch`, which has no defaults. All other stock changes go through `/admin/inventory/adjust`.
- **Images are sent as R2 keys, not URLs.** The API builds the public URL from the key.
- **Guest order lookup is `POST /orders/lookup`** with `{ number, token }` in the body, so the token never appears in a URL.
- Every single amount in cents is capped at 99,999,999 (Stripe's maximum charge). Dates must be `YYYY-MM-DD` or ISO timestamps. A success envelope always has non-null `data`; use `envelope(z.null())` for endpoints that return no body.

### Phase 2 changes from the blueprint

- **The worker lives in `apps/api`** (`src/worker.ts`) rather than a separate `apps/worker` package: it shares all of the API's code and env. Deploy it as a Render background worker running `pnpm --filter @hp/api worker`.
- **Payments and image storage are pluggable.** `PAYMENTS_PROVIDER=fake|stripe` and `IMAGE_STORAGE=fake|r2`; production refuses `fake`. With the fake provider, `POST /checkout/fake-confirm` completes a payment locally.
- **Shipping rules live in `modules/checkout/shipping.ts`:** standard is free from $75 (after discounts), express is always $19.99. Pricing (`cart/pricing.ts`) only zeroes shipping for a FREE_SHIPPING coupon.
- **Tax is a placeholder** table of base state rates. Replace it with Stripe Tax (or similar) before launch.
- **Staff onboarding is invite-only.** `POST /admin/users/invite` emails a one-time link; `POST /admin/auth/accept-invite` sets the password and starts TOTP enrollment. Admin sign-in refuses anyone who hasn't enrolled. The seed prints an invite link instead of using `SEED_ADMIN_PASSWORD` (now unused; delete it from `.env`).
- **Guest lookup tokens** are derived with an HMAC of the order id, so the confirmation email can include the link without the token being stored; email links carry it in the URL fragment (`/orders/<number>#token=…`).
- **The guest-cart cookie path is `/api/v1`** so checkout receives it.
- A new checkout for the same cart cancels that cart's earlier unpaid checkout and releases its stock.
- **`GET /me/wishlist/products`** returns the saved products as summaries (newest first, up to 200, archived ones skipped). `GET /me/wishlist` still returns just ids, which the heart buttons use.
- **The Stripe `return_url` carries only the order number.** The guest lookup token waits in that tab's `sessionStorage` (`hp:pending-order`) across the redirect and is removed as soon as the confirmation page reads it, or when the card is declined on the spot.

### Phase 3 changes

- **Analytics** (`analytics:read`): `GET /admin/analytics/summary`, `/sales-timeseries`, `/top-products` and `/sales-by-category`. An order counts when `paidAt` is in range and it isn't PENDING_PAYMENT or CANCELLED. Revenue is net of refunds; AOV is gross. Gross margin is null when any sold variant has no `costCents`. All buckets are UTC.
- **Report exports** (`analytics:export`, 10 per admin per 15 minutes, audit-logged): `POST /admin/reports` returns 202 with a queued `ReportJob`; `GET /admin/reports` (paged, newest first) and `GET /admin/reports/:jobId` show only the requester's jobs, or every job to a SUPER_ADMIN. The worker's `reports` queue writes CSV (formula injection guarded) or XLSX to the private `R2_REPORTS_BUCKET`, and downloads are 5-minute signed links. Files are kept 7 days; the worker then deletes them and marks the job `expired`. `from`/`to` take `YYYY-MM-DD` (a date-only `to` covers that whole UTC day) or ISO timestamps (`to` exclusive).
- **Admin `Idempotency-Key`** on inventory adjust, cancel and refund: the key is scoped to the admin, a repeat replays the stored response with `Idempotent-Replayed: true`, and the same key with a different body gets 409. Checkout keys also hash the cart contents.
- **Stock holds are 15 minutes** (`RESERVATION_TTL_MINUTES`), with at most 3 open unpaid checkouts per email and 10 per IP (or IPv6 /64). Carts hold up to 50 different items.
- **Guest order links** are HMACs under `ORDER_LOOKUP_SECRET`; rotating it revokes every old link. Password-reset and email-verify links carry the token in `#token=`.
- **Storefront server-side calls** send `X-Internal-Token` (`INTERNAL_API_TOKEN`, shared by the API and the storefront) and `X-HP-Client-IP`; with a matching token the API rate-limits on that shopper's IP rather than the storefront server's. Without the token the header is ignored.
- **Worker jobs:** low-stock alerts every 10 minutes (deduplicated, to active admins and `LOW_STOCK_ALERT_EMAIL`), Stripe payment reconciliation every 15 minutes, `ops.metrics` every 5 minutes, and an hourly purge (alongside expired guest carts) of idempotency records older than 24 hours.
- **Monitoring:** `GET /api/v1/health/live` (no DB or Redis call) for liveness; Sentry via `@sentry/node` only when `SENTRY_DSN` is set, with request bodies, cookies, query strings and users scrubbed; one `payments.webhook` log line per delivery (with its provider) with its outcome.
- **Storefront:** a per-request nonce CSP (set in `src/middleware.ts`), so every page renders per request while catalog fetches stay cached for their `revalidate` time. Canonical URLs, Open Graph and Twitter cards, Product, Breadcrumb, Organization and WebSite JSON-LD, a paged sitemap and robots rules. A coupon field in the cart summary. `pnpm --filter @hp/web build` also enforces a first-load JS budget (170 KB gzipped on product pages, 175 KB elsewhere). A production build needs `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_CDN_URL` (https) and the server-only `INTERNAL_API_TOKEN`. `CLIENT_IP_HEADER` says which header carries the shopper's IP for per-shopper server calls: `cf-connecting-ip` (default, behind Cloudflare), `x-forwarded-for` (read at `TRUSTED_PROXY_HOPS` from the end, default 1) or `none`. Cacheable catalog reads send only the token, so Next's data cache stays shared. The admin needs `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CDN_URL` and the exact `NEXT_PUBLIC_UPLOAD_ORIGIN`.
- **Admin:** an overview dashboard, analytics with charts that each have a data table, and a reports page that queues exports and lists past jobs.
- **Search** uses the trigram `<%` operator so `Product_name_trgm_idx` is used, and facets come from SQL `GROUP BY`.
- **New API env vars:** `ORDER_LOOKUP_SECRET` (required, 32+ characters), `INTERNAL_API_TOKEN` (required in production), `REPORT_STORAGE=fake|r2` (`r2` in production), `R2_REPORTS_BUCKET`, `REPORTS_DIR`, `API_PUBLIC_URL`, `SENTRY_DSN`, `RENDER_GIT_COMMIT`, `LOW_STOCK_ALERT_EMAIL`. Contract additions: `TopProductsQuery`, `CategorySales`, `ReportType`/`ReportFormat`/`ReportStatus`/`ReportJobQuery`, a fuller `ReportJob`, and `MAX_CART_LINES`.

### Phase 3b changes (Oman store)

Full spec: [docs/phase-3b-oman.md](docs/phase-3b-oman.md).

- **One store currency** (`StoreSettings.currency`, OMR by default, 3 decimals). Every amount is integer minor units of that currency; orders keep the currency they were placed in. `PUT /admin/settings/currency` needs a typed confirmation and a 2FA code, and returns 409 `CURRENCY_LOCKED` once any order exists.
- **Settings** (`settings:read` for ADMIN and SUPER_ADMIN, `settings:write` for SUPER_ADMIN): `GET /store` (public: name, currency, VAT, free-shipping threshold, enabled payment methods), `GET /admin/settings`, and `PATCH /admin/settings/general|shipping|payments`. Bank details change only with a 2FA code.
- **Password resets:** admins send a single-use reset link (`POST /admin/users/:id/password-reset`, `user:reset-password`). Staff accounts can be reset by SUPER_ADMIN only. Admins never set or see a password. The link opens `/reset-password#token=`.
- **Admin profile** (`/profile`): name, password change (current password and 2FA code; signs out other sessions) and sign out other devices.
- **Checkout payments:** card (Amwal Pay SmartBox, or Stripe or the dev-only fake provider) or bank transfer. A transfer order waits in `PENDING_PAYMENT` for `bankTransferHoldHours` (default 24), with its stock held until then. An admin confirms receipt with `POST /admin/orders/:id/confirm-transfer` (`order:confirm-payment`, `Idempotency-Key`, and the exact total). Card payments are confirmed only through the provider's webhook, a status check, or reconciliation, all via one path that checks the amount.
- **Oman addresses:** governorate select, +968 phone numbers, and Omani IBANs (23 characters, ISO 13616 mod-97 check). The IBAN format comes from the CBO guidelines; check it against the SWIFT registry before launch.
- **New API env vars:** `PAYMENT_PROVIDER=amwal|stripe|fake` (`fake` is refused in production), `AMWAL_ENV` (`uat` or `production`), `AMWAL_MERCHANT_ID`, `AMWAL_TERMINAL_ID`, `AMWAL_SECURE_KEY`. Placeholders are in `.env.example`.

### Security backlog (close before launch)

Fixed in Phase 1: per-route cache headers, IPv6 /64 rate-limit keys, configurable proxy hops (`TRUST_PROXY_HOPS`, set to 2 behind Cloudflare + Render), per-account login throttling, a separate admin login limiter, and per-admin TOTP throttling.

Fixed in Phase 2: product HTML sanitized on save; invite-only admin 2FA enrollment; checkout re-validates stock under `FOR UPDATE` and coupon limits by email; email sent via the worker queue when Redis is configured; per-IP limits on coupon attempts, checkouts and guest order lookups; expired guest carts purged; absolute refresh-family lifetimes (90 days customer, 12 hours admin).

Fixed in Phase 3:

- **API:** `Idempotency-Key` on admin stock adjustments, refunds and cancels, with a request hash and a 409 when a replay's body differs (checkout keys also cover the cart contents); open unpaid checkouts capped per email (3) and IP (10) with a 15-minute hold; guest lookup tokens moved to `ORDER_LOOKUP_SECRET` (rotation revokes old links); cancel and refund audit entries written in the same transaction; a 50-line cart cap; unhandled-error logs record type, code and stack but no message; a generic coupon error for guests; reset and verify links use `#token=`; facets via SQL `GROUP BY` and search via the trigram `<%` operator; storefront SSR calls rate-limited per shopper (`X-Internal-Token` + `X-HP-Client-IP`).
- **Storefront:** per-request nonce CSP with `'strict-dynamic'` and no `'unsafe-inline'` scripts; product HTML sanitized again at render time; the fixture CDN and `localhost` images are dev-only; HSTS in production; the checkout fingerprint covers cart lines and totals; Stripe.js loads only at the payment step; auth forms post, so a submit before hydration can't put a password in the URL.
- **Both frontends:** a production build refuses mock mode and fails if mock code reaches the output, and `mockServiceWorker.js` is served only by a dev-only route. The admin requires the exact R2 upload origin in production and sends HSTS.

Open:

- **TOTP key rotation:** rotating `TOTP_ENCRYPTION_KEY` needs a re-encryption step for every enrolled admin secret; until then the key can't be rotated without re-enrolling staff.
- **Guest order links never expire:** a lookup token is an HMAC of the order id with no TTL; rotating `ORDER_LOOKUP_SECRET` is the only revocation. Add an expiry bucket.
- **Password reset:** a new reset request doesn't invalidate earlier unused links (each still expires after 1 hour and is single-use).
- **Sentry scrubbing is a denylist:** `extra`, `contexts`, `tags` and `transaction` pass through. Nothing PII-bearing is sent there today.
- **Worker secrets:** `hp-worker` gets the whole `hp-api-secrets` group; split it so the worker has only DB, Redis, SMTP, Stripe, R2 and Sentry.
- **CI action pins:** confirm each pinned SHA in `.github/workflows/ci.yml` matches its tag comment.
- **Style CSP:** `style-src 'unsafe-inline'` in both apps (accepted; script-src is nonce-based).
- **Frontend error tracking:** the API reports to Sentry when `SENTRY_DSN` is set; the storefront and admin have no `@sentry/nextjs` yet.
- **Edge caching:** storefront HTML is rendered per request (each page carries a fresh CSP nonce) and must not be cached at Cloudflare.
- **Not yet verified against real services:** Stripe card payments (including 3-D Secure) with test keys, and R2 report storage.
- **UI gaps:** coupon category restrictions have no picker (existing ones are kept); the admin has no rich-text editor, drag-to-reorder images, bulk actions or packing slips.
- **QA follow-ups:** product pages can show a stale price or stock for up to 60 s (catalog `revalidate`); demo seed images are placeholders; the admin's analytics range ends at `T23:59:59.999Z` rather than the next midnight; no E2E spec yet for analytics and reports; the E2E super-admin token lasts 15 minutes, so very slow runs can expire it.
- **Not yet run in CI:** the k6 load test (re-run on a dedicated runner for real p95 numbers) and the ZAP baseline scan; add them as nightly jobs.
- **Accepted:** registration reveals an existing email (409) for clearer UX; rate limits mitigate enumeration.

### Gate G1 checklist (contract v1 sign-off)

- [x] Backend owner reviewed `packages/contracts/src/*`
- [x] Storefront owner confirmed catalog, cart and checkout shapes
- [x] Admin owner confirmed admin, analytics and RBAC shapes
- [x] QA owner confirmed factories and mock API cover the planned tests
