# Release coverage report — Phase 3 (task 3.4)

Date: 2026-10-12 · Owner: QA (Agent 5) · Format: blueprint §8.5

The tree was still changing under this run (analytics, idempotency, nonce CSP and `#token=` links
were landing in parallel). All numbers come from the working tree at the time of the run.
The final E2E run built every app from that tree with no patches.

## 1. Unit coverage per package

Command: `pnpm exec vitest run --coverage` in each package, with an extra `json-summary`
reporter written outside the repo. All thresholds in the packages' own configs passed.

| Package                             | Lines  | Branches | Functions | Tests | Gate (§8.5)     | Result                          |
| ----------------------------------- | ------ | -------- | --------- | ----- | --------------- | ------------------------------- |
| apps/api (unit, pure modules only¹) | 100%   | 100%     | 100%      | 81    | ≥85 / ≥75 / ≥85 | pass                            |
| apps/api (integration, `test:int`)² | 85.26% | 80.24%   | 91.94%    | —     | ≥85 / ≥75 / ≥85 | pass (stale, see ²)             |
| apps/web                            | 96.09% | 91.09%   | 97.17%    | 226   | ≥70 lines       | pass                            |
| apps/admin                          | 95.84% | 89.62%   | 87.71%    | 230   | ≥70 lines       | pass                            |
| packages/contracts                  | 99.62% | 98.31%   | 100%      | 236   | ≥95 lines       | pass                            |
| packages/api-client                 | 100%   | 93.02%   | 100%      | 13    | —               | pass                            |
| packages/test-utils                 | 97.74% | 90.69%   | 96%       | 39    | —               | pass                            |
| apps/worker                         | n/a    |          |           |       |                 | merged into apps/api in Phase 2 |

¹ `apps/api/vitest.config.ts` measures only `pricing.ts`, `coupons.ts`, `lib/crypto.ts` and
`middleware/error-handler.ts`. Route and service coverage comes from the integration suite.

² Taken from `apps/api/coverage-int/coverage-summary.json`, generated on 2026-10-11 at 08:20
(Phase 2). QA did not re-run `test:int`, because it truncates `hearthandpan_test`, which
the API agent was using. **Action:** CI (or the API owner) re-runs
`pnpm --filter @hp/api test:int --coverage` on the Phase 3 code before sign-off.

## 2. E2E critical paths (Playwright, Chromium desktop)

Stack: API :4100 (tsx, `PAYMENTS_PROVIDER=fake`, `IMAGE_STORAGE=fake`), storefront :3100 and
admin :3101 as production builds (`next build && next start`, so the nonce CSP is
exercised). The database is `hearthandpan_e2e_test`; Mailpit is the mail sink. Every test
uses its own data and client IP.

Final run: `pnpm --filter @hp/e2e test:e2e`, with Playwright `webServer` building all three
apps from the working tree and no patches. 28 tests ran (including setup and axe), 22 passed,
and the run took 26.8 minutes.

| #   | Blueprint path                                                                  | Spec                                              | Result                                                                                                  |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Register → verify email (Mailpit) → sign in                                     | `auth.spec.ts` (2 tests)                          | **pass**                                                                                                |
| 2   | Typo search "skilet" → Cast Iron Skillet; material + price filters              | `catalog.spec.ts`                                 | search **pass**; filters **fail**: D-04 (a 429 on SSR renders the error page)                           |
| 3   | Guest cart → quantity → coupon → sign in → merge                                | `cart.spec.ts`                                    | **pass**, but the coupon is applied through the API: no UI (D-05)                                       |
| 4   | Checkout → confirmation → account history                                       | `checkout.spec.ts`                                | **pass**. Reaches checkout through the cart drawer (client-side); a full reload empties the cart (D-03) |
| 5   | Declined payment → error, never PAID                                            | `payment-failure.spec.ts`                         | **pass** (decline simulated: the fake provider has no card form)                                        |
| 6   | Last-unit race in two browsers → exactly one succeeds                           | `stock-race.spec.ts`                              | **pass**                                                                                                |
| 7   | Admin password + TOTP → product with image → on storefront                      | `admin-auth.spec.ts` (3), `admin-product.spec.ts` | **pass**                                                                                                |
| 8   | Admin ships with tracking → customer sees it; STAFF can't refund (hidden + 403) | `admin-orders.spec.ts`                            | **pass**                                                                                                |
| +   | Guest checkout → emailed `#token=` link → order page                            | `checkout.spec.ts`                                | **pass**                                                                                                |
| +   | Password reset via Mailpit                                                      | `auth.spec.ts`                                    | **pass**                                                                                                |
| +   | Admin refund (full), admin cancel + email                                       | `admin-orders.spec.ts`                            | **pass**                                                                                                |
| +   | Known defect D-03 (expected-fail marker)                                        | `cart.spec.ts`                                    | expected failure observed                                                                               |

**Critical paths: 7 / 8 fully passing.** Path 2 fails on D-04, and the gate in §8.5 requires
8 / 8, so this blocks release. Earlier runs during the day also failed on D-01, D-02 and
D-03, all caused by in-flight storefront work. D-01 and D-02 were fixed before the final run.

## 3. Accessibility (axe-core 4.10, WCAG 2.0/2.1/2.2 A+AA + best-practice)

Scanned with `e2e/tests/a11y.spec.ts`; the gate fails on serious or critical violations.

| Page                                                   | Result                                          |
| ------------------------------------------------------ | ----------------------------------------------- |
| Storefront home                                        | **fail**: role-img-alt x4 (D-06)                |
| Listing `/shop`                                        | **fail**: role-img-alt x19 (D-06)               |
| Search `/shop?q=skillet`                               | **fail**: role-img-alt x1 (D-06)                |
| PDP, login, register                                   | pass                                            |
| Cart drawer, cart page                                 | **fail**: role-img-alt x1 (D-06)                |
| Checkout                                               | pass                                            |
| Admin login                                            | pass                                            |
| Admin overview, products, orders, new product, reports | pass                                            |
| Admin analytics                                        | **fail**: scrollable-region-focusable x2 (D-07) |

An earlier run also reported one `color-contrast` (serious) on `.btn-primary` on the home
page; it did not reproduce in the final run. Keep an eye on it. Placeholders show up so
often here because every image in E2E uses a fictional CDN, but D-06 also hits production
whenever an image is missing or fails to load.

## 4. Performance (k6, `e2e/load/storefront.js`)

The run used `grafana/k6:1.0.0` in Docker against `host.docker.internal:4100`. The scenario
is a browse → search → PDP → add-to-cart journey at a constant arrival rate, for 1 minute.

| Run                | Request rate | browse p95 | search p95 | PDP p95 | add to cart p95 | errors | Thresholds |
| ------------------ | ------------ | ---------- | ---------- | ------- | --------------- | ------ | ---------- |
| RATE=50 journeys/s | 167 req/s    | 883 ms     | 850 ms     | 845 ms  | 4.05 s          | 0.00%  | **fail**   |
| RATE=13 journeys/s | 43 req/s     | 3.43 s     | 2.13 s     | 2.92 s  | 7.95 s          | 0.00%  | **fail**   |

Target (§8.1): `/products` search p95 < 300 ms at 50 rps. **Not met, but these runs are not a
valid benchmark.** The API ran from TypeScript through tsx, not a build. The machine is a
Windows laptop that was running other agents' `next build` and test jobs at the same time;
the slower result at the _lower_ rate shows that contention dominated. Treat this as a
smoke test: no errors and no 429s, because each simulated shopper sends its own
X-Forwarded-For. **Action:** re-run on a dedicated runner against the built API
(`node dist/server.js`) before launch. Add-to-cart was the slowest step in both runs, so
profile `POST /cart/items` first.

## 5. Security (OWASP ZAP baseline, `ghcr.io/zaproxy/zaproxy:stable`, rules `e2e/zap/rules.tsv`)

`node e2e/scripts/run-zap.mjs` runs a passive scan with a 2-minute spider. Reports go to
`e2e/zap/reports/` (gitignored).

| Target                      | FAIL | WARN | Notes                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ---- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API `:4100/api/v1/products` | 0    | 0    | 66 pass; INFO only (non-storable content)                                                                                                                                                                                                                                                                                                                                               |
| Admin `:3101/login`         | 0    | 4    | 10024 password in URL (D-08), CSP `style-src 'unsafe-inline'`, COEP missing, auth request identified                                                                                                                                                                                                                                                                                    |
| Storefront `:3100/`         | 1    | 6    | FAIL 90022 is an **environment artifact**: `/_next/image` returns 500 for the fictional CDN host. WARN 10024 credentials in URL on `/login`, `/register`, `/forgot-password` (D-08); 10031 user-controlled attribute (`?next=`, `?sort=`), which is reflected but encoded, so review only; CSP `style-src 'unsafe-inline'`; COEP missing; 10019 no Content-Type on the 500 and on a 308 |

No high-risk findings in application code. `rules.tsv` ignores Secure-cookie and HSTS
checks, because the E2E stack runs over plain http on localhost; production sets both.

## 6. New tests in this release

`e2e/` is a new workspace package (`@hp/e2e`):

- `tests/auth.spec.ts`: register → verify (Mailpit) → sign in; single-use verify link; password reset via Mailpit.
- `tests/catalog.spec.ts`: typo search; material and price filters.
- `tests/cart.spec.ts`: guest cart → quantity → coupon → sign in → merge; known defect D-03.
- `tests/checkout.spec.ts`: signed-in checkout → history; guest checkout → emailed lookup link.
- `tests/payment-failure.spec.ts`: declined payment, simulated at the fake provider's confirm call.
- `tests/stock-race.spec.ts`: two browsers race for the last unit.
- `tests/admin-auth.spec.ts`: invite → TOTP enrollment in the UI → password + TOTP sign-in; wrong code; wrong password.
- `tests/admin-product.spec.ts`: product with an image upload → live PDP.
- `tests/admin-orders.spec.ts`: ship with tracking → customer email and account page; STAFF has no refund (UI hidden, API 403); full refund; cancel.
- `tests/a11y.spec.ts`: axe on 7 storefront and 6 admin views.

## 7. Quarantined / flaky tests

None are quarantined. One test is marked `test.fail()` on purpose: D-03 in `cart.spec.ts`.
It passes while the defect exists and turns red once D-03 is fixed; remove the marker then.

## 8. Open defects by severity

| ID   | Severity             | Status               | Summary                                                                                                                                                                                                      | Where                                                                                                                                                                  | Repro                                                                                                                                 |
| ---- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| D-04 | **High**             | open                 | Storefront SSR calls the API from one IP and shares the general per-IP limit (100/min). Under load, pages render "Something boiled over" (429 `RATE_LIMITED`)                                                | `apps/api/src/app.ts:137` (`rl:general`) + `apps/web/src/lib/api.ts:27` (`serverApi` sends no client identity)                                                         | Run 2 E2E workers, or >100 SSR API calls/min: `/shop?material=...` returns the error page; the web log shows `ApiClientError ... 429` |
| D-03 | **High**             | open                 | After any full page load, a signed-in customer's cart shows the guest cart (usually empty). `GET /cart` runs before the session refresh and is never refetched. Direct `/checkout` says "Your cart is empty" | `apps/web/src/lib/cart.ts:102-106` (`useCart` has no auth gate and its key ignores auth)                                                                               | Sign in → add to cart → reload `/cart` (spec `cart.spec.ts` > Known defect D-03)                                                      |
| D-01 | Critical             | **fixed during run** | Storefront `next build` failed: `instrumentation.ts` dynamic-imported `msw/node` behind an early return, so the Edge bundle (new nonce middleware) tried to resolve it                                       | `apps/web/src/instrumentation.ts`                                                                                                                                      | Fixed by the web agent before the final run                                                                                           |
| D-02 | Critical             | **fixed during run** | `tsc` failure: `type Stripe` imported from `@stripe/stripe-js/pure`                                                                                                                                          | `apps/web/src/components/checkout/StripePayment.tsx:6`                                                                                                                 | Fixed by the web agent                                                                                                                |
| D-05 | Medium               | open                 | The storefront has no coupon field; `POST /cart/coupon` exists but no UI calls it (blueprint path 3)                                                                                                         | `apps/web/src/components/cart/CartContents.tsx` / `OrderSummary.tsx`                                                                                                   | Look for a coupon input on `/cart` or `/checkout`                                                                                     |
| D-06 | Medium (axe serious) | open                 | The image placeholder is `role="img"` with `aria-label=""` when the caller passes `alt=""`                                                                                                                   | `apps/web/src/components/catalog/ProductImage.tsx:25-26`; callers `ProductCard.tsx:16`, `CartLineItem.tsx:26`                                                          | Any product image that fails to load; axe `role-img-alt`                                                                              |
| D-07 | Medium (axe serious) | open                 | Horizontally scrollable tables on Analytics aren't keyboard-focusable                                                                                                                                        | `apps/admin/src/components/analytics/Breakdowns.tsx:39,78`                                                                                                             | axe on `/analytics`                                                                                                                   |
| D-08 | Medium               | open                 | Auth forms have no `method="post"`. Submitted before hydration (slow JS, JS off), they GET with the password in the query string, which ends up in history and logs                                          | `apps/web/src/components/auth/AuthForm.tsx:91`, `apps/admin/src/components/auth/LoginForm.tsx:54` (also `ForgotPasswordForm`, `ResetPasswordForm`, `AcceptInviteForm`) | ZAP 10024; or disable JS and submit `/login`                                                                                          |
| D-09 | Low                  | open                 | PDP is ISR (`revalidate = 60`), so stock/"Only N left" can be up to 60 s stale after a sale; checkout still refuses oversell                                                                                 | `apps/web/src/app/(shop)/p/[slug]/page.tsx:20`                                                                                                                         | Sell the last unit; the PDP still offers Add to cart                                                                                  |
| D-10 | Low                  | open                 | Demo seed images point at the fixture CDN, which production storefront builds refuse. With `SEED_DEMO_CATALOG=true` in production, every demo image falls back to the placeholder                            | `apps/api/prisma/seed.ts` (sample catalog URLs)                                                                                                                        | Seed with the demo catalog, then `next build && next start`                                                                           |
| P-01 | Perf (unverified)    | open                 | k6 targets missed on a contended dev machine; add-to-cart p95 was 4-8 s                                                                                                                                      | section 4                                                                                                                                                              | Re-run on a dedicated runner                                                                                                          |

Blocking release: D-04, D-03 (High), plus the 8 / 8 E2E gate and the axe gate (D-06, D-07).
