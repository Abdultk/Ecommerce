# Phase 3b — Oman store, settings, payments

Requested after Phase 3 (before Gate G4 / launch). Decisions from the owner:

| Topic           | Decision                                                                                |
| --------------- | --------------------------------------------------------------------------------------- |
| Market          | An Omani shop. Store currency OMR (3 decimals: 1 OMR = 1000 baisa).                     |
| Password resets | Admin sends a reset **link**; admins never see or set passwords.                        |
| Currency        | **One store currency**, chosen in admin settings. Locked once any order exists.         |
| Card payments   | **Amwal Pay** SmartBox (replaced Thawani, 2026-10-24) (card data never touches our servers). Stripe adapter kept. |
| Bank transfer   | **Manual bank transfer**: stock held **24 hours**, an admin confirms receipt.           |

Owners: Backend (contracts, API, worker, Prisma), Storefront (`apps/web`), Admin (`apps/admin`). The contract in `packages/contracts` is the source of truth; nobody invents fields beyond this doc without updating it.

## 1. Money and currency

- Money stays **integer minor units** in every `*Cents` field. The name is historical: for OMR a "cent" is a baisa. Do not rename fields.
- `packages/contracts/src/money.ts` (new):
  - `CURRENCIES`: `OMR` (3), `AED` (2), `SAR` (2), `QAR` (2), `KWD` (3), `BHD` (3), `USD` (2), `EUR` (2), `GBP` (2). `CurrencyCode = z.enum([...])`.
  - `currencyExponent(code)`, `formatMoney(minor, code, locale = "en-OM")` built on `Intl.NumberFormat` with the exponent as fraction digits, and `rescaleMinor(amount, fromCode, toCode)` (multiply or divide by 10^Δ, rounding half up).
  - Every app formats money through `formatMoney`; delete per-app `/ 100` logic.
- `OrderSummary`, `OrderDetail`, `AdminOrderListItem`, `AdminOrderDetail` and `Cart` gain `currency: CurrencyCode`. Orders keep the currency they were placed in (`Order.currency` already exists; default becomes `OMR`).
- Analytics and reports use the store currency; `AnalyticsSummary` gains `currency`.

## 2. Oman localization

- `ShippingAddress` (input) becomes Oman-only:
  - `country: "OM"`;
  - `region`: governorate, ISO 3166-2:OM code: `MA` Muscat, `ZU` Dhofar, `MU` Musandam, `BU` Al Buraimi, `DA` Ad Dakhiliyah, `BS` North Al Batinah, `BJ` South Al Batinah, `SS` North Ash Sharqiyah, `SJ` South Ash Sharqiyah, `ZA` Ad Dhahirah, `WU` Al Wusta. Export `OMAN_GOVERNORATES` as `{ code, name }[]`.
  - `city`: wilayat (free text); `line1`: area / street; `line2`: building, flat, landmark (optional);
  - `postalCode`: optional, 3 digits;
  - `phone`: **required**, normalised to `+968` followed by 8 digits.
- Read models (`OrderDetail.shippingAddress`, stored `Address`) use a lenient `StoredAddress` (all strings) so older US-shaped test orders still parse.
- **VAT**: flat rate from settings (`vatRateBps`, default 500 = 5%) applied to (subtotal − discount), as today. Delete `STATE_TAX_BPS`.
- **Shipping**: rates, free-shipping threshold and delivery days come from settings, not code. Defaults (OMR): standard 2.000, express 5.000, free standard shipping from 30.000; standard 2–4 days, express 1 day.
- Seed: demo prices in OMR (e.g. a skillet 18.500 OMR); coupon `WELCOME10` unchanged (percent).

## 3. Store settings

Singleton Prisma model `StoreSettings` (`id = "default"`, created by migration with the defaults above).

Contract (`packages/contracts/src/settings.ts`):

```ts
BankDetails = { bankName, accountName, accountNumber, iban /* OM + 21 alnum, checksum-validated */, swift?: string, instructions?: string /* ≤500 */ }
StoreSettings = {
  storeName, currency: CurrencyCode, vatRateBps: 0–2500,
  shipping: { standardCents, expressCents, freeShippingThresholdCents: Cents | null,
              standardDays: {min,max}, expressDays: {min,max} },
  payments: { cardEnabled, bankTransferEnabled, bankTransferHoldHours: 1–168 (default 24), bank: BankDetails | null },
  updatedAt }
PublicStoreConfig = { storeName, currency, vatRateBps, freeShippingThresholdCents, paymentMethods: PaymentMethod[] }
```

Rules: at least one payment method enabled; `bankTransferEnabled` requires `bank`.

Endpoints:

| Method + path                    | Permission       | Notes                                                                                                                                                                                                                                                |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /store`                     | public           | `PublicStoreConfig`, `Cache-Control: public, max-age=60`                                                                                                                                                                                             |
| `GET /admin/settings`            | `settings:read`  | `StoreSettings`                                                                                                                                                                                                                                      |
| `PATCH /admin/settings/general`  | `settings:write` | `{ storeName?, vatRateBps? }`                                                                                                                                                                                                                        |
| `PATCH /admin/settings/shipping` | `settings:write` | shipping block                                                                                                                                                                                                                                       |
| `PATCH /admin/settings/payments` | `settings:write` | payments block; **`totpCode` required** when `bank` changes (step-up: a stolen session can't redirect customer payments)                                                                                                                             |
| `PUT /admin/settings/currency`   | `settings:write` | `{ currency, confirm /* must equal currency */, totpCode }`. 409 `CURRENCY_LOCKED` if any order exists. Otherwise rescales every stored amount (variant price/compareAt/cost, coupon FIXED value and minimum, shipping settings) in one transaction. |

All writes are audit-logged with before/after (bank account number and IBAN masked to the last 4 in the log).

## 4. Permissions (`rbac.ts`)

New: `settings:read` (ADMIN, SUPER_ADMIN), `settings:write` (SUPER_ADMIN), `user:reset-password` (ADMIN, SUPER_ADMIN), `order:confirm-payment` (ADMIN, SUPER_ADMIN).

## 5. Admin-initiated password reset

`POST /admin/users/:userId/password-reset` (`user:reset-password`), body `{ resetTwoFactor?: boolean }` → 202 `{ sent: true }`.

- Target is a customer: any holder of the permission. Target is staff: **SUPER_ADMIN only**. Nobody targets themselves (use the profile page). 403 otherwise.
- Invalidates the target's earlier unused reset tokens (apply the same rule to self-service forgot-password; this closes the backlog item "earlier reset links stay valid"), creates a 1-hour reset token, revokes **all** the target's refresh tokens, and emails the link through the worker queue.
  - Customers get the storefront link `/reset-password#token=`.
  - Staff get the admin link `/reset-password#token=` (new admin page); 2FA stays enrolled.
  - Staff with `resetTwoFactor: true` (SUPER_ADMIN only): clears TOTP and sends a fresh **invite** instead (the accept-invite flow re-enrolls 2FA).
- Rate limit: 20 per admin per hour. Audit-logged (`user.password_reset_sent`).
- `POST /admin/auth/reset-password` `{ token, password }` for staff tokens (customer tokens rejected there, and staff tokens rejected by the customer endpoint).

## 6. Admin profile

| Method + path                           | Body                                         | Notes                                                                          |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /admin/me`                         | —                                            | `AdminProfile = PublicUser + { totpEnabledAt }`                                |
| `PATCH /admin/me`                       | `ProfileUpdate`                              | name only; email changes go through a SUPER_ADMIN                              |
| `POST /admin/me/password`               | `{ currentPassword, newPassword, totpCode }` | revokes every **other** session; 401 on a wrong password or code; rate-limited |
| `POST /admin/me/sessions/revoke-others` | —                                            | signs out other devices                                                        |

Audit-logged. Lost authenticator → a SUPER_ADMIN uses §5 with `resetTwoFactor`.

## 7. Checkout payments

Contract (`orders.ts`):

```ts
PaymentMethod = z.enum(["card", "bank_transfer"])
CheckoutInput += { paymentMethod: PaymentMethod }   // must be enabled in settings, else 422 PAYMENT_METHOD_UNAVAILABLE
CheckoutIntent = { orderNumber, lookupToken, totals, currency, payment: CheckoutPayment }
CheckoutPayment = discriminatedUnion("kind", [
  { kind: "redirect", provider: "amwal" | "fake", redirectUrl: HttpUrl },   // card via Amwal Pay
  { kind: "client_secret", provider: "stripe", clientSecret },                // card via Stripe (kept)
  { kind: "bank_transfer", reference /* = order number */, amountCents, currency, dueAt, bank: BankDetails },
])
OrderSummary/OrderDetail += { paymentMethod: PaymentMethod, paymentDueAt: IsoDateTime | null }
OrderDetail += { bankTransfer: { reference, amountCents, dueAt, bank } | null }  // only while PENDING_PAYMENT by transfer
POST /checkout/status { number, token? }  →  { status: OrderStatus }   // return page polling; signed-in owners need no token
```

Prisma `Order`: add `paymentMethod` (`CARD` | `BANK_TRANSFER`, default `CARD`), `paymentProvider` (`amwal` | `stripe` | `fake` | `manual`), rename `stripePaymentIntentId` → `providerPaymentId` (unique), add `providerSessionId`, `transferConfirmedById`, `transferBankReference`. `Refund` gains `provider` and `bankReference`.

### Card via Amwal Pay (SmartBox)

- `PaymentGateway.createIntent` is replaced by `createPayment(input) → CheckoutPayment` (Stripe returns `client_secret`, Amwal returns `redirect`, to an API page that opens SmartBox).
- Thawani: create a checkout session server-side (secret key header), one line item for the order total in baisa, `client_reference_id` = order number, success/cancel URLs to `${WEB_ORIGIN}/checkout/return?number=…`, `metadata.orderId`. Redirect to the hosted page with the publishable key.
- **Never trust the redirect.** Payment is confirmed by (a) a verified Thawani webhook, (b) `POST /checkout/status` fetching the session from Thawani server-side, or (c) the reconciliation job. All three call the same `markOrderPaid` path, which checks that the amount received equals the order total.
- Refunds through Thawani's refund API with the derived idempotency key, as Stripe does today.
- **Verify every Thawani endpoint, field, signature scheme and limit against Thawani's official developer docs** and record the URLs in the adapter. Where the docs are unclear, stop and report rather than guess. Unit/integration tests use a fixture-based fake (no network).
- Env: `PAYMENT_PROVIDER=thawani|stripe|fake`, `THAWANI_ENV=uat|production`, `THAWANI_SECRET_KEY`, `THAWANI_PUBLISHABLE_KEY`, `THAWANI_WEBHOOK_SECRET`. Production refuses `fake` and refuses `THAWANI_ENV=uat`.
- Dev/test: the `fake` provider returns a redirect to a dev-only page that can mark the order paid or failed (404 in production).

### Bank transfer

- Order is created `PENDING_PAYMENT`, `paymentMethod = BANK_TRANSFER`, stock reserved until `now + bankTransferHoldHours` (24 h). The order-placed email includes bank details, amount, reference and due time.
- `POST /admin/orders/:id/confirm-transfer` (`order:confirm-payment`, `Idempotency-Key` required): `{ receivedCents, bankReference, note? }`. Only for `BANK_TRANSFER` orders in `PENDING_PAYMENT` (an expired-and-cancelled order gets 409). `receivedCents` must equal the total (otherwise 422 `AMOUNT_MISMATCH`; the admin contacts the customer). Calls `markOrderPaid` (commits stock, empties the cart, sends the payment-confirmed email), writes an `OrderEvent` and audit entry.
- `ORDER_TRANSITIONS` comment: PENDING_PAYMENT → PAID happens only via `markOrderPaid` (verified provider confirmation or an admin-confirmed transfer); still not settable through the status endpoint.
- The reservation-release job cancels expired transfer orders and emails the customer that the order was cancelled because payment did not arrive.
- Refunds of transfer orders are **manual**: `RefundInput` gains `bankReference` (required for transfer orders); no provider call; `Refund.provider = "manual"`.

## 8. UI

Storefront:

- Fetch `GET /store` (server, cached) and format all money with `formatMoney`; orders use their own `currency`. Remove the hard-coded "Free shipping over $75"; JSON-LD `priceCurrency` from the store.
- Oman address form (governorate select, wilayat, area/street, building, optional postal code, required +968 phone).
- Payment step: radio for each enabled method. Card → redirect to Amwal Pay (the Stripe Element only when the provider is Stripe; load Stripe.js only then). Bank transfer → confirmation page with bank details, amount, reference, due time and copy buttons.
- `/checkout/return`: polls `POST /checkout/status`, then shows success, pending or "payment didn't go through" with a retry.
- Order pages show "Awaiting bank transfer" with the details and due time.

Admin:

- **Settings** (nav, `settings:read`): General (store name, VAT), Currency (typed confirmation + 2FA code; disabled with an explanation once orders exist), Shipping, Payments (toggles, bank details, hold hours; 2FA code when bank details change).
- **Profile** (user menu): name, change password (current + new + 2FA code), sign out other devices.
- **Users**: "Send password reset" (confirm dialog); for staff, SUPER_ADMIN sees "also reset 2FA".
- **Orders**: payment-method column and filter, "Awaiting transfer" badge with due time; on a pending transfer order, "Confirm transfer received" (amount pre-filled, bank reference required); manual refunds ask for a bank reference.
- **Admin reset-password page** at `/reset-password#token=`.
- Money via `formatMoney` with the store currency; MSW mocks for every new endpoint.

## 9. Done means

TDD, ≥80% coverage per package, contract tests for every new schema, API integration tests for every endpoint (permissions, step-up, currency lock, rescale, transfer expiry, amount mismatch, idempotent confirm), `pnpm format:check` and `pnpm turbo lint typecheck test build` green, then code and security review. README and `.env.example` updated (placeholders only).

### Amwal Pay replaces Thawani (2026-10-24)

Card payments now use Amwal Pay SmartBox. The adapter is `apps/api/src/lib/payments/amwal.ts` and lists the Amwal developer-portal pages it follows.

- Checkout returns a `redirect` to `/api/v1/checkout/amwal-pay/:token` (signed with `COOKIE_SECRET`, holds only the order number). That page reads the amount from the order, computes the secure hash on the server and opens SmartBox. The secure key never reaches a browser.
- Order number = Amwal `merchantReference`. Payment is confirmed by `POST /Transaction/GetByMerchantReference` (an approved Purchase has `responseCode` `00`), triggered by the cloud notification at `/api/v1/webhooks/amwal` or by the return page status check. The redirect back is never trusted.
- Refunds use `POST /Execute/Refund`.
- Env: `AMWAL_ENV`, `AMWAL_MERCHANT_ID`, `AMWAL_TERMINAL_ID`, `AMWAL_SECURE_KEY` (hex). Production refuses `AMWAL_ENV=uat`.
- Verify against UAT before going live: the refund hash field set, refund request-id semantics, how Amwal appends result parameters to a return URL that already has a query string, and the notification Amount text.
