# Hearth & Pan — Kitchen Commerce Platform Blueprint

Version 1.0 · 2026-10-10 · Lead orchestrator plan for a five-agent build team

This document is the single source of truth for building a production-grade ecommerce site for kitchen items (cookware, knives, utensils, small appliances, storage) with a full admin dashboard. "Hearth & Pan" is a working name; replace it everywhere with your brand.

How to use it:

- **Handing it to a team:** give each engineer Sections 0–3 plus their own agent section. Section 9 is the schedule.
- **Executing it yourself (or with AI agents):** Section 10 contains a ready-to-paste brief for each agent. Run them in the order given in Section 9.

---

## 0. Executive summary

| Concern | Decision |
|---|---|
| Repo layout | One Turborepo monorepo, pnpm workspaces |
| Storefront | Next.js 15 (App Router, React 19, Server Components), Tailwind CSS 4 |
| Admin dashboard | Separate Next.js 15 app on `admin.` subdomain, shadcn/ui, TanStack Table, Recharts |
| API | Node.js 22 + Express 5 + TypeScript, REST, versioned at `/api/v1` |
| Shared contract | `packages/contracts`: Zod schemas → TypeScript types + generated OpenAPI 3.1 |
| Database | PostgreSQL 16 via Prisma ORM 6; full-text search with `tsvector` + `pg_trgm` |
| Cache / jobs | Redis 7 (rate limiting, BullMQ job queue for email, exports, stock jobs) |
| Auth | Email + password (Argon2id), short-lived JWT access token + rotating refresh token in httpOnly cookie; RBAC; TOTP 2FA required for admin roles |
| Payments | Stripe Payment Intents + Payment Element; webhooks are the source of truth for "paid" |
| Images | Cloudflare R2 (S3-compatible) with presigned uploads; served via CDN + Next/Image |
| Email | Resend (transactional) driven by a BullMQ worker |
| Hosting | Vercel (storefront + admin), Render (API, worker, Postgres, Redis), Cloudflare (DNS, R2, WAF) |
| CI/CD | GitHub Actions: lint → typecheck → unit → integration → build → E2E (Playwright) → deploy |
| Observability | Sentry (errors + traces), pino structured logs → Better Stack, uptime checks |

---

## 1. Technology stack and justification

### 1.1 Framework: Next.js (frontends) + Express (API)

- **Next.js 15 for the storefront** gives server rendering and incremental static regeneration for product and category pages, which matters for SEO on a catalog site. Server Components keep the JS bundle small on mobile. Vercel's edge CDN caches pages close to shoppers.
- **A separate Next.js app for admin** keeps admin code, dependencies and attack surface out of the public bundle. It can sit behind extra controls (IP allowlist, Cloudflare Access) without touching the store.
- **A standalone Express API rather than Next.js route handlers**, because the business logic (checkout, inventory, webhooks, reports) is shared by two frontends, runs background jobs, and must be tested in isolation. Express 5 is well-documented and forwards async errors natively. NestJS is a fine alternative for larger teams; this plan keeps the lighter option.
- **REST over GraphQL:** the domain is resource-shaped (products, carts, orders), HTTP caching helps the catalog, and REST is simpler to secure per route for admin permissions.

### 1.2 Database: PostgreSQL + Prisma

- Orders, payments and stock are relational and need ACID transactions (reserve stock and create the order atomically).
- Postgres full-text search plus trigram similarity covers typo-tolerant search for a catalog of up to ~50k SKUs without running Elasticsearch. Meilisearch can be added later behind the same `SearchService` interface.
- Prisma gives typed queries, a readable schema file and a migration history that CI applies with `prisma migrate deploy`.

### 1.3 Authentication: JWT access + rotating refresh tokens

- Access token: JWT, 15 minutes, sent as `Authorization: Bearer`, held in memory by the client.
- Refresh token: opaque random 256-bit value, stored **hashed** in the DB, sent as an `httpOnly; Secure; SameSite=Lax` cookie scoped to `/api/v1/auth`, rotated on every use, with reuse detection (a reused token revokes the whole token family).
- This avoids storing tokens in `localStorage` (XSS theft) while keeping most requests stateless.
- Admin roles (`STAFF`, `ADMIN`, `SUPER_ADMIN`) must enroll TOTP 2FA; admin refresh cookies use `SameSite=Strict` and an 8-hour lifetime.

### 1.4 Payment gateway: Stripe

- Payment Intents + Payment Element support cards, Apple Pay, Google Pay, Link and 3-D Secure (SCA) with one integration.
- Card data never touches our servers, which keeps PCI scope at SAQ A.
- Built-in refunds, disputes, Stripe Tax (optional) and test mode with published test cards.
- PayPal can be added later as a second `PaymentProvider` implementation.

### 1.5 Hosting

| Component | Platform | Why |
|---|---|---|
| `apps/web` storefront | Vercel | Native Next.js, edge cache, preview deploys per PR |
| `apps/admin` | Vercel (separate project) | Same, with isolated env vars and domain |
| `apps/api` | Render Web Service (Docker) | Simple, autoscaling, private networking to DB/Redis |
| `apps/worker` | Render Background Worker | Runs BullMQ jobs (emails, CSV exports, stock alerts) |
| PostgreSQL | Render Postgres (or Neon) | Managed backups, point-in-time recovery |
| Redis | Render Key Value | Same private network as the API |
| Images | Cloudflare R2 + custom domain `cdn.` | No egress fees, S3 API |
| DNS, TLS, WAF | Cloudflare | Free TLS, bot protection, edge rate limits |

**Scale-out path:** when traffic outgrows this, move the API container to AWS ECS Fargate + RDS Postgres + ElastiCache. Nothing in the code is Render-specific; it only reads env vars.

---

## 2. System architecture

```
                    ┌──────────────────── Cloudflare (DNS, TLS, WAF) ────────────────────┐
                    │                                                                    │
 Shoppers ──► www.hearthandpan.com (Vercel: apps/web)     Staff ──► admin.hearthandpan.com (Vercel: apps/admin)
                    │   Next.js SSR/ISR                               │  Next.js, client-heavy
                    │                                                 │
                    └────────────► api.hearthandpan.com (Render: apps/api) ◄──────┘
                                        │  Express 5, /api/v1/*
                                        │  /api/v1/admin/*  (RBAC + 2FA)
           Stripe ──webhooks──────────► │  /api/v1/webhooks/stripe
                                        ▼                         ▼
                             PostgreSQL 16 (Prisma)      Redis 7 (rate limit, BullMQ)
                                                                  │
                                                   apps/worker (emails, exports, stock jobs)

           Cloudflare R2 (product images) ◄── presigned PUT from admin browser
```

### 2.1 Monorepo layout

```
hearth-and-pan/
├── apps/
│   ├── api/            # Agent 1 — Express API
│   ├── worker/         # Agent 1 — BullMQ job processor
│   ├── web/            # Agent 2 — customer storefront
│   └── admin/          # Agent 3 — admin dashboard
├── packages/
│   ├── contracts/      # Agent 1 owns, all agents consume — Zod schemas, types, OpenAPI
│   ├── api-client/     # Agent 1 — typed fetch client used by web + admin
│   ├── ui/             # Agent 2 owns, Agent 3 may consume — shared primitives
│   ├── config/         # Agent 4 — eslint, tsconfig, prettier presets
│   └── test-utils/     # Agent 5 — factories, fixtures, Stripe test helpers
├── e2e/                # Agent 5 — Playwright suites
├── infra/              # Agent 4 — docker-compose, render.yaml, scripts
├── docs/               # BLUEPRINT.md, ADRs, runbooks, QA reports
├── .github/workflows/  # Agent 4 — CI/CD
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

```jsonc
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
    "lint":      { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test":      { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "test:int":  { "dependsOn": ["^build"], "cache": false },
    "dev":       { "cache": false, "persistent": true }
  }
}
```

---

## 3. The shared API contract (all agents)

The contract lives in `packages/contracts`. **Agent 1 owns it; every change is a PR reviewed by the consuming agents.** Frontends import types from it and never hand-write response shapes.

### 3.1 Conventions

- Base URL: `https://api.hearthandpan.com/api/v1`
- JSON only, `camelCase` fields, ISO-8601 UTC timestamps.
- **Money is always integer minor units** (`priceCents: 4999` = $49.99). No floats anywhere.
- IDs are `cuid` strings. Products also have a unique `slug` for URLs. Orders have a human-facing `number` (`HP-2026-000123`).
- Pagination: `?page=1&pageSize=24` (max 100). Sorting: `?sort=relevance|price_asc|price_desc|newest|popular`.
- Idempotency: `POST /checkout/*` and all admin mutations accept an `Idempotency-Key` header.
- Rate limits: 100 req/min/IP general, 5 req/min/IP on login and password reset, 20 req/min on checkout.

### 3.2 Response envelope

```ts
// packages/contracts/src/envelope.ts
import { z } from "zod";

export const ApiError = z.object({
  code: z.enum([
    "VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND",
    "CONFLICT", "OUT_OF_STOCK", "COUPON_INVALID", "PAYMENT_FAILED",
    "RATE_LIMITED", "INTERNAL",
  ]),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export const PageMeta = z.object({
  page: z.number().int(), pageSize: z.number().int(),
  total: z.number().int(), totalPages: z.number().int(),
});

export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.boolean(),
    data: data.nullable(),
    error: ApiError.nullable(),
    meta: PageMeta.optional(),
  });
```

Success: `{ "success": true, "data": { ... }, "error": null }`

Failure: `{ "success": false, "data": null, "error": { "code": "OUT_OF_STOCK", "message": "Only 2 left of Cast Iron Skillet 10\"", "details": { "variantId": "...", "available": 2 } } }`

### 3.3 Core schemas (excerpt)

```ts
// packages/contracts/src/catalog.ts
import { z } from "zod";

export const ProductImage = z.object({ id: z.string(), url: z.string().url(), alt: z.string(), position: z.number().int() });

export const ProductVariant = z.object({
  id: z.string(), sku: z.string(), name: z.string(),          // "10 inch / Black"
  priceCents: z.number().int().positive(),
  compareAtPriceCents: z.number().int().positive().nullable(),
  stockAvailable: z.number().int().nonnegative(),             // onHand - reserved
  attributes: z.record(z.string()),                            // { size: "10in", color: "Black" }
});

export const ProductSummary = z.object({
  id: z.string(), slug: z.string(), name: z.string(),
  brand: z.string().nullable(), categorySlug: z.string(),
  fromPriceCents: z.number().int(), thumbnailUrl: z.string().url().nullable(),
  ratingAvg: z.number().min(0).max(5), ratingCount: z.number().int(),
  inStock: z.boolean(),
});

export const ProductDetail = ProductSummary.extend({
  description: z.string(),                    // sanitized HTML
  material: z.string().nullable(),            // "Enameled cast iron"
  careInstructions: z.string().nullable(),    // "Hand wash only"
  dishwasherSafe: z.boolean().nullable(),
  inductionCompatible: z.boolean().nullable(),
  ovenSafeToF: z.number().int().nullable(),   // 500
  images: z.array(ProductImage),
  variants: z.array(ProductVariant),
});

export const ProductQuery = z.object({
  q: z.string().max(100).optional(),
  category: z.string().optional(),
  brand: z.array(z.string()).optional(),
  material: z.array(z.string()).optional(),
  minPrice: z.coerce.number().int().optional(),
  maxPrice: z.coerce.number().int().optional(),
  inStock: z.coerce.boolean().optional(),
  inductionCompatible: z.coerce.boolean().optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "popular"]).default("relevance"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type ProductQuery = z.infer<typeof ProductQuery>;
```

```ts
// packages/contracts/src/orders.ts
export const OrderStatus = z.enum([
  "PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED",
  "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

// Allowed transitions — enforced on the server, mirrored in the admin UI.
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT:    ["CANCELLED"],
  PAID:               ["PROCESSING", "CANCELLED", "REFUNDED"],
  PROCESSING:         ["SHIPPED", "CANCELLED", "REFUNDED"],
  SHIPPED:            ["DELIVERED", "REFUNDED", "PARTIALLY_REFUNDED"],
  DELIVERED:          ["REFUNDED", "PARTIALLY_REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

export const CheckoutInput = z.object({
  email: z.string().email(),
  shippingAddress: z.object({
    fullName: z.string().min(1).max(100), line1: z.string().min(1).max(200), line2: z.string().max(200).optional(),
    city: z.string().min(1), region: z.string().min(2), postalCode: z.string().min(3).max(10),
    country: z.literal("US"), phone: z.string().max(20).optional(),
  }),
  shippingMethod: z.enum(["standard", "express"]),
});
export type CheckoutInput = z.infer<typeof CheckoutInput>;
```

### 3.4 Endpoint catalogue

**Public / customer** — auth column: `—` public, `C` signed-in customer, `G` guest cart cookie or customer.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | — | Create customer account and send a verification email. Always 202 with no session; an existing email gets a notice email instead, so it cannot be probed |
| POST | `/auth/resend-verification` | — | Resend the verification link to an unverified customer. Always 202 |
| POST | `/auth/login` | — | Return access token, set refresh cookie |
| POST | `/auth/refresh` | cookie | Rotate refresh token, return new access token |
| POST | `/auth/logout` | cookie | Revoke refresh token family |
| POST | `/auth/verify-email` | — | Confirm email with token |
| POST | `/auth/forgot-password`, `/auth/reset-password` | — | Reset flow (always returns 202) |
| GET | `/categories` | — | Category tree |
| GET | `/products` | — | Search, filter, sort, paginate (`ProductQuery`) |
| GET | `/products/facets` | — | Counts per brand / material / price bucket for the current query |
| GET | `/products/:slug` | — | Product detail |
| GET | `/products/:slug/reviews` | — | Paginated reviews |
| POST | `/products/:slug/reviews` | C | Review (verified purchasers only) |
| GET | `/cart` | G | Current cart with computed totals |
| POST | `/cart/items` | G | `{ variantId, quantity }` |
| PATCH | `/cart/items/:itemId` | G | Change quantity |
| DELETE | `/cart/items/:itemId` | G | Remove line |
| POST / DELETE | `/cart/coupon` | G | Apply / remove coupon |
| POST | `/cart/merge` | C | Merge guest cart into user cart after login |
| POST | `/checkout/shipping-quote` | G | Shipping options for an address |
| POST | `/checkout/intent` | G | Validate cart, reserve stock, create order + Stripe PaymentIntent, return `clientSecret` |
| GET | `/orders`, `/orders/:number` | C | Order history / detail |
| GET | `/orders/lookup?number=&token=` | — | Guest order status (token emailed with confirmation) |
| POST | `/orders/:number/cancel` | C | Cancel if status is `PENDING_PAYMENT` or `PAID` |
| GET / PATCH | `/me` | C | Profile |
| GET / POST / PATCH / DELETE | `/me/addresses[/:id]` | C | Address book |
| GET / POST / DELETE | `/me/wishlist[/:productId]` | C | Wishlist |
| POST | `/webhooks/stripe` | Stripe signature | Payment events |
| GET | `/health` | — | Liveness + DB/Redis readiness |

**Admin** — all under `/admin`; require an access token with an admin role **and** the `tfa: true` claim. Permission column shows the required permission.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/admin/auth/login` | — | Step 1: password → short-lived `challengeToken` |
| POST | `/admin/auth/2fa` | challenge | Step 2: TOTP code → access token + strict refresh cookie |
| GET | `/admin/products` | `product:read` | Table view incl. drafts; filter by status / stock |
| POST | `/admin/products` | `product:write` | Create (draft by default) |
| PATCH | `/admin/products/:id` | `product:write` | Update, incl. variants and images |
| DELETE | `/admin/products/:id` | `product:delete` | Soft-delete (archive) |
| POST | `/admin/uploads/presign` | `product:write` | Presigned R2 PUT URL for an image |
| POST / PATCH / DELETE | `/admin/categories[/:id]` | `product:write` | Category management |
| GET | `/admin/orders` | `order:read` | Filter by status, date range, customer, total |
| GET | `/admin/orders/:id` | `order:read` | Full detail with payment + timeline |
| PATCH | `/admin/orders/:id/status` | `order:write` | Transition per `ORDER_TRANSITIONS`; tracking number |
| POST | `/admin/orders/:id/cancel` | `order:write` | Cancel, release stock, void/refund payment |
| POST | `/admin/orders/:id/refund` | `order:refund` | Full or partial Stripe refund |
| GET | `/admin/users` | `user:read` | Customers and staff |
| PATCH | `/admin/users/:id` | `user:write` | Disable/enable; change role (SUPER_ADMIN only) |
| GET | `/admin/inventory` | `inventory:read` | Stock per variant; low-stock filter |
| POST | `/admin/inventory/adjust` | `inventory:write` | `{ variantId, delta, reason }` → ledger entry |
| GET / POST / PATCH / DELETE | `/admin/coupons[/:id]` | `coupon:write` | Discount codes |
| GET | `/admin/analytics/summary` | `analytics:read` | KPIs for a date range vs previous period |
| GET | `/admin/analytics/sales-timeseries` | `analytics:read` | Revenue / orders per day, week or month |
| GET | `/admin/analytics/top-products` | `analytics:read` | Best sellers by revenue and units |
| POST | `/admin/reports` | `analytics:export` | Queue CSV/XLSX export, returns job id |
| GET | `/admin/reports/:jobId` | `analytics:export` | Status + signed download URL |
| GET | `/admin/audit-log` | `audit:read` | Every admin mutation |

### 3.5 Role → permission matrix

| Permission | CUSTOMER | STAFF | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|
| product:read, inventory:read, order:read | | ✓ | ✓ | ✓ |
| product:write, inventory:write, order:write | | ✓ | ✓ | ✓ |
| product:delete, order:refund, coupon:write | | | ✓ | ✓ |
| user:read, analytics:read, analytics:export | | | ✓ | ✓ |
| user:write (roles), audit:read | | | | ✓ |

```ts
// packages/contracts/src/rbac.ts
export const ALL_PERMISSIONS = [
  "product:read", "product:write", "product:delete",
  "inventory:read", "inventory:write",
  "order:read", "order:write", "order:refund",
  "coupon:write", "user:read", "user:write",
  "analytics:read", "analytics:export", "audit:read",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];
export type Role = "CUSTOMER" | "STAFF" | "ADMIN" | "SUPER_ADMIN";

const STAFF: Permission[] = ["product:read", "product:write", "inventory:read", "inventory:write", "order:read", "order:write"];
const ADMIN: Permission[] = [...STAFF, "product:delete", "order:refund", "coupon:write", "user:read", "analytics:read", "analytics:export"];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  CUSTOMER: new Set(),
  STAFF: new Set(STAFF),
  ADMIN: new Set(ADMIN),
  SUPER_ADMIN: new Set(ALL_PERMISSIONS),
};

export const can = (role: Role, perm: Permission) => ROLE_PERMISSIONS[role].has(perm);
```

The admin UI uses the same `can()` to hide controls; the API uses it to enforce them. Hiding is UX only; the server check is the security boundary.

---

## 4. Agent 1 — Backend Architect & API Developer

**Owns:** `apps/api`, `apps/worker`, `packages/contracts`, `packages/api-client`, Prisma schema and migrations.
**Delivers to others:** contract package (Day 2), seeded local stack (Day 3), OpenAPI docs at `/api/v1/docs`.

### 4.1 File structure

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                 # generated, committed
│   └── seed.ts                     # categories, 60 demo products, admin from env
├── src/
│   ├── server.ts                   # boot, graceful shutdown
│   ├── app.ts                      # express app factory (used by tests)
│   ├── routes.ts                   # mounts module routers
│   ├── config/env.ts               # zod-validated env, fail fast
│   ├── lib/
│   │   ├── prisma.ts  redis.ts  logger.ts  stripe.ts  r2.ts  queue.ts
│   │   ├── errors.ts               # AppError + error codes
│   │   └── respond.ts              # ok(), paged() envelope helpers
│   ├── middleware/
│   │   ├── authenticate.ts         # verify JWT, attach req.user; requireAdmin2FA; requirePermission
│   │   ├── validate.ts             # zod body / query / params
│   │   ├── rateLimit.ts            # Redis-backed sliding window
│   │   ├── guestCart.ts            # signed cart cookie for guests
│   │   ├── auditLog.ts             # records admin mutations
│   │   └── errorHandler.ts
│   ├── modules/
│   │   ├── auth/      auth.routes.ts auth.service.ts tokens.ts password.ts totp.ts
│   │   ├── catalog/   catalog.routes.ts catalog.service.ts search.repository.ts
│   │   ├── cart/      cart.routes.ts cart.service.ts pricing.ts
│   │   ├── checkout/  checkout.routes.ts checkout.service.ts shipping.ts
│   │   ├── orders/    orders.routes.ts orders.service.ts
│   │   ├── payments/  stripe.webhook.ts payments.service.ts
│   │   ├── users/     me.routes.ts users.service.ts
│   │   ├── reviews/   reviews.routes.ts reviews.service.ts
│   │   └── admin/
│   │       ├── index.ts            # mounts admin routers behind authenticate + requireAdmin2FA + auditLog
│   │       ├── auth.admin.ts  products.admin.ts  orders.admin.ts  users.admin.ts
│   │       ├── inventory.admin.ts  coupons.admin.ts  uploads.admin.ts
│   │       └── analytics.admin.ts  reports.admin.ts  audit.admin.ts
│   └── jobs/                       # job payload types shared with the worker
├── test/                           # Agent 5 writes, Agent 1 keeps green
├── Dockerfile
└── package.json

apps/worker/src/
├── index.ts                        # BullMQ workers + repeatable jobs
├── processors/ email.ts report-export.ts release-expired-reservations.ts low-stock-alert.ts reconcile-payments.ts
└── emails/ order-confirmation.tsx shipped.tsx password-reset.tsx verify-email.tsx   # React Email templates
```

### 4.2 Database schema (Prisma)

```prisma
// apps/api/prisma/schema.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearchPostgres"]
}
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role          { CUSTOMER STAFF ADMIN SUPER_ADMIN }
enum ProductStatus { DRAFT ACTIVE ARCHIVED }
enum OrderStatus   { PENDING_PAYMENT PAID PROCESSING SHIPPED DELIVERED CANCELLED REFUNDED PARTIALLY_REFUNDED }
enum CouponType    { PERCENT FIXED FREE_SHIPPING }
enum StockReason   { RESTOCK SALE RETURN DAMAGE CORRECTION }

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  passwordHash    String
  firstName       String
  lastName        String
  role            Role      @default(CUSTOMER)
  emailVerifiedAt DateTime?
  totpSecretEnc   String?                     // AES-256-GCM encrypted
  disabledAt      DateTime?
  lastLoginAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  addresses       Address[]
  orders          Order[]
  cart            Cart?
  reviews         Review[]
  wishlist        WishlistItem[]
  refreshTokens   RefreshToken[]
  @@index([role])
}

model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  familyId   String                           // rotation chain
  tokenHash  String    @unique                // sha256(token + pepper)
  expiresAt  DateTime
  revokedAt  DateTime?
  replacedBy String?
  userAgent  String?
  ip         String?
  createdAt  DateTime  @default(now())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([familyId])
}

model Address {
  id         String  @id @default(cuid())
  userId     String
  fullName   String
  line1      String
  line2      String?
  city       String
  region     String
  postalCode String
  country    String  @db.Char(2)
  phone      String?
  isDefault  Boolean @default(false)
  user       User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model Category {
  id       String     @id @default(cuid())
  slug     String     @unique
  name     String                              // "Cookware", "Knives & Cutlery"
  parentId String?
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children Category[] @relation("CategoryTree")
  position Int        @default(0)
  products Product[]
}

model Product {
  id                  String           @id @default(cuid())
  slug                String           @unique
  name                String
  brand               String?
  description         String                    // sanitized HTML
  material            String?
  careInstructions    String?
  dishwasherSafe      Boolean?
  inductionCompatible Boolean?
  ovenSafeToF         Int?
  status              ProductStatus    @default(DRAFT)
  categoryId          String
  category            Category         @relation(fields: [categoryId], references: [id])
  variants            ProductVariant[]
  images              ProductImage[]
  reviews             Review[]
  wishlistedBy        WishlistItem[]
  ratingAvg           Decimal          @default(0) @db.Decimal(3, 2)
  ratingCount         Int              @default(0)
  salesCount          Int              @default(0)   // denormalized for "popular" sort
  searchVector        Unsupported("tsvector")?       // maintained by trigger (see migration SQL)
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt
  @@index([status, categoryId])
  @@index([brand])
}

model ProductVariant {
  id                  String          @id @default(cuid())
  productId           String
  sku                 String          @unique
  name                String
  attributes          Json            @default("{}")
  priceCents          Int
  compareAtPriceCents Int?
  costCents           Int?                       // admin-only, for margin reports
  stockOnHand         Int             @default(0)
  stockReserved       Int             @default(0)
  lowStockThreshold   Int             @default(5)
  weightGrams         Int?
  isActive            Boolean         @default(true)
  product             Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  movements           StockMovement[]
  @@index([productId])
}

model ProductImage {
  id        String  @id @default(cuid())
  productId String
  key       String                                // R2 object key
  url       String
  alt       String
  position  Int     @default(0)
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  @@index([productId, position])
}

model StockMovement {                             // append-only ledger of stockOnHand changes
  id        String         @id @default(cuid())
  variantId String
  delta     Int                                    // signed change to stockOnHand
  reason    StockReason
  note      String?
  orderId   String?
  actorId   String?                                // admin who made a manual change
  createdAt DateTime       @default(now())
  variant   ProductVariant @relation(fields: [variantId], references: [id])
  @@index([variantId, createdAt])
}

model Cart {
  id         String     @id @default(cuid())
  userId     String?    @unique
  couponCode String?
  expiresAt  DateTime
  updatedAt  DateTime   @updatedAt
  user       User?      @relation(fields: [userId], references: [id], onDelete: Cascade)
  items      CartItem[]
}

model CartItem {
  id        String @id @default(cuid())
  cartId    String
  variantId String
  quantity  Int
  cart      Cart   @relation(fields: [cartId], references: [id], onDelete: Cascade)
  @@unique([cartId, variantId])
}

model Coupon {
  id               String     @id @default(cuid())
  code             String     @unique             // stored uppercase
  type             CouponType
  value            Int                            // percent (1–100) or cents
  minSubtotalCents Int        @default(0)
  maxRedemptions   Int?
  perCustomerLimit Int?       @default(1)
  redemptions      Int        @default(0)
  startsAt         DateTime?
  endsAt           DateTime?
  isActive         Boolean    @default(true)
  categoryIds      String[]                       // empty = all categories
  createdAt        DateTime   @default(now())
}

model Order {
  id                    String      @id @default(cuid())
  number                String      @unique       // "HP-2026-000123"
  lookupTokenHash       String?                    // for guest order lookup
  userId                String?
  email                 String
  status                OrderStatus @default(PENDING_PAYMENT)
  subtotalCents         Int
  discountCents         Int         @default(0)
  shippingCents         Int
  taxCents              Int
  totalCents            Int
  currency              String      @default("USD")
  couponCode            String?
  shippingAddress       Json                       // snapshot, not a FK
  billingAddress        Json?
  shippingMethod        String
  trackingNumber        String?
  stripePaymentIntentId String?     @unique
  reservationExpiresAt  DateTime?
  paidAt                DateTime?
  cancelledAt           DateTime?
  createdAt             DateTime    @default(now())
  updatedAt             DateTime    @updatedAt
  user                  User?       @relation(fields: [userId], references: [id])
  items                 OrderItem[]
  events                OrderEvent[]
  refunds               Refund[]
  @@index([status, createdAt])
  @@index([userId, createdAt])
  @@index([paidAt])
}

model OrderItem {
  id             String @id @default(cuid())
  orderId        String
  variantId      String
  productName    String                 // snapshots so history survives catalog edits
  variantName    String
  sku            String
  unitPriceCents Int
  quantity       Int
  lineTotalCents Int
  order          Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([variantId])
}

model OrderEvent {                        // timeline shown in admin and customer views
  id         String       @id @default(cuid())
  orderId    String
  type       String                       // "created", "payment_succeeded", "status_changed", "note"
  fromStatus OrderStatus?
  toStatus   OrderStatus?
  message    String?
  actorId    String?
  createdAt  DateTime     @default(now())
  order      Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId, createdAt])
}

model Refund {
  id             String   @id @default(cuid())
  orderId        String
  amountCents    Int
  reason         String?
  stripeRefundId String   @unique
  actorId        String
  createdAt      DateTime @default(now())
  order          Order    @relation(fields: [orderId], references: [id])
}

model Review {
  id        String   @id @default(cuid())
  productId String
  userId    String
  rating    Int                           // 1..5, CHECK constraint in migration
  title     String
  body      String
  isVisible Boolean  @default(true)
  createdAt DateTime @default(now())
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id])
  @@unique([productId, userId])
}

model WishlistItem {
  userId    String
  productId String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  @@id([userId, productId])
}

model ProcessedWebhook {                  // idempotency for Stripe events
  eventId     String   @id
  processedAt DateTime @default(now())
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String
  action    String                        // "PATCH /admin/orders/:id/status"
  entity    String
  entityId  String?
  before    Json?
  after     Json?
  ip        String?
  createdAt DateTime @default(now())
  @@index([entity, entityId])
  @@index([actorId, createdAt])
}
```

Hand-written SQL appended to the first migration (Prisma can't express these):

```sql
-- prisma/migrations/20261012000000_init/migration.sql (appended)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "ProductVariant" ADD CONSTRAINT stock_valid
  CHECK ("stockOnHand" >= 0 AND "stockReserved" >= 0 AND "stockReserved" <= "stockOnHand");
ALTER TABLE "Review" ADD CONSTRAINT rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "Order"  ADD CONSTRAINT totals_consistent
  CHECK ("totalCents" = "subtotalCents" - "discountCents" + "shippingCents" + "taxCents");

CREATE FUNCTION product_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
       setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A')
    || setweight(to_tsvector('english', coalesce(NEW.brand, '')), 'B')
    || setweight(to_tsvector('english', coalesce(NEW.material, '')), 'C')
    || setweight(to_tsvector('english', regexp_replace(coalesce(NEW.description, ''), '<[^>]+>', ' ', 'g')), 'D');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER product_search_vector_trg
  BEFORE INSERT OR UPDATE OF name, brand, material, description ON "Product"
  FOR EACH ROW EXECUTE FUNCTION product_search_vector_update();

CREATE INDEX product_search_idx    ON "Product" USING GIN ("searchVector");
CREATE INDEX product_name_trgm_idx ON "Product" USING GIN (name gin_trgm_ops);
```

**Inventory model:** `stockOnHand` is physical stock; `stockReserved` is held by unpaid orders; available = onHand − reserved. Reservations only change `stockReserved`. Every change to `stockOnHand` (sale, restock, return, damage, correction) writes one `StockMovement` row, so the ledger always sums to the current on-hand figure.

### 4.3 Environment validation

```ts
// apps/api/src/config/env.ts
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_PEPPER: z.string().min(32),
  TOTP_ENCRYPTION_KEY: z.string().length(64),       // 32 bytes hex
  CORS_ORIGINS: z.string().transform((s) => s.split(",")),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  R2_ACCOUNT_ID: z.string(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET: z.string(),
  CDN_BASE_URL: z.string().url(),
  SENTRY_DSN: z.string().url().optional(),
  RESERVATION_TTL_MINUTES: z.coerce.number().default(15),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = Object.freeze(parsed.data);
```

### 4.4 App factory, security middleware and errors

```ts
// apps/api/src/app.ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { rateLimit } from "./middleware/rateLimit";
import { errorHandler } from "./middleware/errorHandler";
import { stripeWebhook } from "./modules/payments/stripe.webhook";
import { apiRouter } from "./routes";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Stripe needs the raw body to verify signatures — mount BEFORE express.json()
  app.post("/api/v1/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, redact: ["req.headers.authorization", "req.headers.cookie"] }));
  app.use("/api/v1", rateLimit({ windowSec: 60, max: 100 }), apiRouter);
  app.use(errorHandler);
  return app;
}
```

```ts
// apps/api/src/lib/errors.ts
export type ErrorCode = "VALIDATION_ERROR" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND"
  | "CONFLICT" | "OUT_OF_STOCK" | "COUPON_INVALID" | "PAYMENT_FAILED" | "RATE_LIMITED" | "INTERNAL";

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  OUT_OF_STOCK: 409, COUPON_INVALID: 422, PAYMENT_FAILED: 402, RATE_LIMITED: 429, INTERNAL: 500,
};

export class AppError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
  }
  get status() { return HTTP_STATUS[this.code]; }
}
```

```ts
// apps/api/src/middleware/errorHandler.ts
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import * as Sentry from "@sentry/node";
import { AppError } from "../lib/errors";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ success: false, data: null,
      error: { code: "VALIDATION_ERROR", message: "Some fields are invalid.", details: err.flatten().fieldErrors } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, data: null,
      error: { code: err.code, message: err.message, details: err.details } });
  }
  req.log.error({ err }, "unhandled error");
  Sentry.captureException(err);
  return res.status(500).json({ success: false, data: null,
    error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
};
```

### 4.5 Authentication and authorization

```ts
// apps/api/src/modules/auth/tokens.ts
import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Role } from "@hp/contracts";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";

const ACCESS_TTL = "15m";
const REFRESH_TTL_MS = { customer: 30 * 24 * 3600_000, admin: 8 * 3600_000 };
const SESSION_EXPIRED = "Your session has expired. Please sign in again.";

export type AccessClaims = { sub: string; role: Role; tfa: boolean };

export const signAccess = (claims: AccessClaims) =>
  jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL, issuer: "hp-api", audience: "hp" });

export const verifyAccess = (token: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: "hp-api", audience: "hp", algorithms: ["HS256"] }) as AccessClaims;

const hashToken = (t: string) => createHash("sha256").update(t + env.REFRESH_TOKEN_PEPPER).digest("hex");

export async function issueRefresh(userId: string, isAdmin: boolean, familyId = randomBytes(16).toString("hex")) {
  const token = randomBytes(32).toString("base64url");
  const ttl = isAdmin ? REFRESH_TTL_MS.admin : REFRESH_TTL_MS.customer;
  await prisma.refreshToken.create({
    data: { userId, familyId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttl) },
  });
  return token;
}

/** Rotates a refresh token. Presenting an already-rotated token revokes the whole family (theft signal). */
export async function rotateRefresh(presented: string) {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presented) }, include: { user: true },
  });
  if (!existing) throw new AppError("UNAUTHENTICATED", SESSION_EXPIRED);

  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() },
    });
    throw new AppError("UNAUTHENTICATED", SESSION_EXPIRED);
  }
  if (existing.expiresAt < new Date() || existing.user.disabledAt) {
    throw new AppError("UNAUTHENTICATED", SESSION_EXPIRED);
  }

  const isAdmin = existing.user.role !== "CUSTOMER";
  const next = await issueRefresh(existing.userId, isAdmin, existing.familyId);
  await prisma.refreshToken.update({
    where: { id: existing.id }, data: { revokedAt: new Date(), replacedBy: hashToken(next) },
  });
  return { user: existing.user, refreshToken: next };
}
```

```ts
// apps/api/src/modules/auth/password.ts
import argon2 from "argon2";

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations)
export const hashPassword = (plain: string) =>
  argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hash: string, plain: string) => argon2.verify(hash, plain);
```

```ts
// apps/api/src/middleware/authenticate.ts
import type { RequestHandler } from "express";
import { can, type Permission } from "@hp/contracts";
import { verifyAccess } from "../modules/auth/tokens";
import { AppError } from "../lib/errors";

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(new AppError("UNAUTHENTICATED", "Please sign in."));
  try {
    req.user = verifyAccess(header.slice(7));
    next();
  } catch {
    next(new AppError("UNAUTHENTICATED", "Your session has expired."));
  }
};

export const requireAdmin2FA: RequestHandler = (req, _res, next) => {
  if (!req.user || req.user.role === "CUSTOMER") return next(new AppError("FORBIDDEN", "Admin access only."));
  if (!req.user.tfa) return next(new AppError("FORBIDDEN", "Two-factor verification required."));
  next();
};

export const requirePermission = (perm: Permission): RequestHandler => (req, _res, next) =>
  req.user && can(req.user.role, perm)
    ? next()
    : next(new AppError("FORBIDDEN", "You don't have permission to do that."));
```

```ts
// apps/api/src/modules/admin/index.ts
import { Router } from "express";
import { authenticate, requireAdmin2FA } from "../../middleware/authenticate";
import { auditLog } from "../../middleware/auditLog";
import { adminAuthRouter } from "./auth.admin";
import { productsAdmin } from "./products.admin";
import { ordersAdmin } from "./orders.admin";
import { inventoryAdmin } from "./inventory.admin";
import { analyticsAdmin } from "./analytics.admin";
// ...users, coupons, uploads, reports, audit

export const adminRouter = Router();
adminRouter.use("/auth", adminAuthRouter);                // the only group without the guard
adminRouter.use(authenticate, requireAdmin2FA, auditLog); // everything below: admin role + 2FA + audited
adminRouter.use("/products", productsAdmin);
adminRouter.use("/orders", ordersAdmin);
adminRouter.use("/inventory", inventoryAdmin);
adminRouter.use("/analytics", analyticsAdmin);
```

### 4.6 Catalog search

```ts
// apps/api/src/modules/catalog/search.repository.ts
import { Prisma } from "@prisma/client";
import type { ProductQuery } from "@hp/contracts";
import { prisma } from "../../lib/prisma";

const ORDER_BY: Record<ProductQuery["sort"], Prisma.Sql> = {
  relevance:  Prisma.sql`rank DESC, p."salesCount" DESC`,
  price_asc:  Prisma.sql`v.from_price ASC`,
  price_desc: Prisma.sql`v.from_price DESC`,
  newest:     Prisma.sql`p."createdAt" DESC`,
  popular:    Prisma.sql`p."salesCount" DESC`,
};

export async function searchProducts(q: ProductQuery) {
  const tsq = q.q ? Prisma.sql`websearch_to_tsquery('english', ${q.q})` : null;
  const conditions: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`];

  if (q.q) conditions.push(Prisma.sql`(p."searchVector" @@ ${tsq} OR similarity(p.name, ${q.q}) > 0.3)`);
  if (q.category) conditions.push(Prisma.sql`c.slug = ${q.category}`);
  if (q.brand?.length) conditions.push(Prisma.sql`p.brand = ANY(${q.brand})`);
  if (q.material?.length) conditions.push(Prisma.sql`p.material = ANY(${q.material})`);
  if (q.inductionCompatible) conditions.push(Prisma.sql`p."inductionCompatible" = true`);
  if (q.minPrice != null) conditions.push(Prisma.sql`v.from_price >= ${q.minPrice}`);
  if (q.maxPrice != null) conditions.push(Prisma.sql`v.from_price <= ${q.maxPrice}`);
  if (q.inStock) conditions.push(Prisma.sql`v.available > 0`);

  const rank = q.q ? Prisma.sql`ts_rank(p."searchVector", ${tsq}) + similarity(p.name, ${q.q})` : Prisma.sql`0`;
  const offset = (q.page - 1) * q.pageSize;

  // Every user value is a bound parameter via Prisma.sql — never string-concatenated.
  const rows = await prisma.$queryRaw<Array<Record<string, unknown> & { total: bigint }>>`
    WITH v AS (
      SELECT "productId", MIN("priceCents") AS from_price,
             SUM("stockOnHand" - "stockReserved") AS available
      FROM "ProductVariant" WHERE "isActive" GROUP BY "productId"
    )
    SELECT p.id, p.slug, p.name, p.brand, c.slug AS "categorySlug",
           v.from_price AS "fromPriceCents", (v.available > 0) AS "inStock",
           p."ratingAvg"::float AS "ratingAvg", p."ratingCount",
           (SELECT url FROM "ProductImage" i WHERE i."productId" = p.id ORDER BY position LIMIT 1) AS "thumbnailUrl",
           ${rank} AS rank, COUNT(*) OVER() AS total
    FROM "Product" p
    JOIN "Category" c ON c.id = p."categoryId"
    JOIN v ON v."productId" = p.id
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${ORDER_BY[q.sort]}
    LIMIT ${q.pageSize} OFFSET ${offset}`;

  const total = Number(rows[0]?.total ?? 0);
  const items = rows.map(({ total: _total, rank: _rank, ...rest }) => rest);
  return { items, meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) } };
}
```

### 4.7 Pricing (pure function, unit-tested)

```ts
// apps/api/src/modules/cart/pricing.ts
export type PricedLine = { unitPriceCents: number; quantity: number; categoryId: string };
export type CouponRule = {
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  minSubtotalCents: number;
  categoryIds: string[];
};

export const FREE_SHIPPING_THRESHOLD_CENTS = 7_500;
const BASIS_POINTS = 10_000;

const lineTotal = (l: PricedLine) => l.unitPriceCents * l.quantity;

export function computeTotals(lines: PricedLine[], shippingQuoteCents: number, taxRateBps: number, coupon?: CouponRule) {
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const qualifies = coupon !== undefined && subtotal >= coupon.minSubtotalCents;

  const eligible = qualifies && coupon.categoryIds.length > 0
    ? lines.filter((l) => coupon.categoryIds.includes(l.categoryId)).reduce((s, l) => s + lineTotal(l), 0)
    : subtotal;

  const discount =
    !qualifies ? 0
    : coupon.type === "PERCENT" ? Math.floor((eligible * coupon.value) / 100)
    : coupon.type === "FIXED" ? Math.min(coupon.value, eligible)
    : 0;

  const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD_CENTS || (qualifies && coupon.type === "FREE_SHIPPING");
  const shipping = freeShipping ? 0 : shippingQuoteCents;
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * taxRateBps) / BASIS_POINTS);

  return {
    subtotalCents: subtotal,
    discountCents: discount,
    shippingCents: shipping,
    taxCents: tax,
    totalCents: taxable + shipping + tax,
  };
}
```

### 4.8 Checkout: reserve stock + create PaymentIntent

```ts
// apps/api/src/modules/checkout/checkout.service.ts
import { Prisma } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import type { CheckoutInput } from "@hp/contracts";
import { prisma } from "../../lib/prisma";
import { stripe } from "../../lib/stripe";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { computeTotals } from "../cart/pricing";
import { loadCouponForCart } from "../cart/cart.service";
import { quoteShipping, taxRateFor } from "./shipping";
import { nextOrderNumber } from "../orders/orders.service";

type LockedVariant = {
  id: string; stockOnHand: number; stockReserved: number; priceCents: number;
  sku: string; name: string; productName: string; categoryId: string;
};

export async function createCheckoutIntent(cartId: string, input: CheckoutInput, userId?: string) {
  const lookupToken = randomBytes(24).toString("base64url");

  const order = await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({ where: { id: cartId }, include: { items: true } });
    if (!cart?.items.length) throw new AppError("VALIDATION_ERROR", "Your cart is empty.");

    // Lock variant rows so two shoppers can't buy the last unit at the same time.
    const ids = cart.items.map((i) => i.variantId);
    const variants = await tx.$queryRaw<LockedVariant[]>`
      SELECT v.id, v."stockOnHand", v."stockReserved", v."priceCents", v.sku, v.name,
             p.name AS "productName", p."categoryId"
      FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
      WHERE v.id = ANY(${ids}) AND v."isActive" AND p.status = 'ACTIVE'
      ORDER BY v.id
      FOR UPDATE OF v`;

    const byId = new Map(variants.map((v) => [v.id, v]));
    const lines = cart.items.map((item) => {
      const v = byId.get(item.variantId);
      if (!v) throw new AppError("CONFLICT", "An item in your cart is no longer available.");
      const available = v.stockOnHand - v.stockReserved;
      if (available < item.quantity) {
        throw new AppError("OUT_OF_STOCK", `Only ${available} left of ${v.productName}.`, { variantId: v.id, available });
      }
      return { v, quantity: item.quantity };
    });

    const coupon = await loadCouponForCart(tx, cart.couponCode, userId, input.email);
    const shipping = quoteShipping(input.shippingAddress, input.shippingMethod, lines);
    const totals = computeTotals(
      lines.map(({ v, quantity }) => ({ unitPriceCents: v.priceCents, quantity, categoryId: v.categoryId })),
      shipping.cents, taxRateFor(input.shippingAddress), coupon ?? undefined,
    );

    const created = await tx.order.create({
      data: {
        number: await nextOrderNumber(tx),
        lookupTokenHash: createHash("sha256").update(lookupToken).digest("hex"),
        userId, email: input.email, ...totals,
        couponCode: coupon ? cart.couponCode : null,
        shippingAddress: input.shippingAddress,
        shippingMethod: shipping.method,
        reservationExpiresAt: new Date(Date.now() + env.RESERVATION_TTL_MINUTES * 60_000),
        items: { create: lines.map(({ v, quantity }) => ({
          variantId: v.id, productName: v.productName, variantName: v.name, sku: v.sku,
          unitPriceCents: v.priceCents, quantity, lineTotalCents: v.priceCents * quantity,
        })) },
        events: { create: { type: "created", toStatus: "PENDING_PAYMENT" } },
      },
    });

    for (const { v, quantity } of lines) {
      await tx.productVariant.update({ where: { id: v.id }, data: { stockReserved: { increment: quantity } } });
    }
    return created;
  }, { timeout: 10_000 });

  // Network call to Stripe happens outside the DB transaction. Idempotency key = order id.
  const intent = await stripe.paymentIntents.create({
    amount: order.totalCents,
    currency: "usd",
    receipt_email: order.email,
    automatic_payment_methods: { enabled: true },
    metadata: { orderId: order.id, orderNumber: order.number },
  }, { idempotencyKey: `order-${order.id}` });

  await prisma.order.update({ where: { id: order.id }, data: { stripePaymentIntentId: intent.id } });
  return { orderNumber: order.number, lookupToken, clientSecret: intent.client_secret!, totals };
}
```

The worker's repeatable job `release-expired-reservations` runs every minute: for `PENDING_PAYMENT` orders past `reservationExpiresAt`, it cancels the PaymentIntent, decrements `stockReserved`, and marks the order `CANCELLED` with an `OrderEvent`.

### 4.9 Stripe webhook (the only path to PAID)

```ts
// apps/api/src/modules/payments/stripe.webhook.ts
import type { RequestHandler } from "express";
import type Stripe from "stripe";
import { stripe } from "../../lib/stripe";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { queue } from "../../lib/queue";

export const stripeWebhook: RequestHandler = async (req, res) => {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"] as string, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    req.log.warn({ err }, "stripe signature verification failed");
    return res.status(400).send("Invalid signature");
  }

  // Stripe retries deliveries; process each event exactly once.
  const inserted = await prisma.processedWebhook.createMany({ data: [{ eventId: event.id }], skipDuplicates: true });
  if (inserted.count === 0) return res.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await markPaid(event.data.object as Stripe.PaymentIntent);
        break;
      case "charge.refunded":
        await syncRefund(event.data.object as Stripe.Charge);
        break;
      case "payment_intent.payment_failed":
        req.log.info({ pi: event.data.object.id }, "payment failed");
        break;
    }
    res.json({ received: true });
  } catch (err) {
    await prisma.processedWebhook.delete({ where: { eventId: event.id } }); // let Stripe retry
    throw err;
  }
};

async function markPaid(pi: Stripe.PaymentIntent) {
  const orderId = pi.metadata.orderId;
  const paid = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.status !== "PENDING_PAYMENT") return null;        // already handled, or expired and cancelled
    if (pi.amount_received !== order.totalCents) throw new Error(`Amount mismatch on ${order.number}`);

    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stockOnHand: { decrement: item.quantity }, stockReserved: { decrement: item.quantity } },
      });
      await tx.stockMovement.create({ data: { variantId: item.variantId, delta: -item.quantity, reason: "SALE", orderId } });
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "PAID", paidAt: new Date(), reservationExpiresAt: null,
        events: { create: { type: "payment_succeeded", fromStatus: "PENDING_PAYMENT", toStatus: "PAID" } },
      },
    });
    if (order.couponCode) {
      await tx.coupon.update({ where: { code: order.couponCode }, data: { redemptions: { increment: 1 } } });
    }
    if (order.userId) await tx.cart.deleteMany({ where: { userId: order.userId } });
    return order;
  });

  if (paid) {
    await queue.add("email", { template: "order-confirmation", orderId });
    await queue.add("low-stock-check", { orderId });
  }
}
```

If a payment succeeds for an order that already expired (rare, slow 3-D Secure), the handler leaves it `CANCELLED` and the nightly `reconcile-payments` job flags it for an automatic refund and an admin alert.

### 4.10 Admin: order status transition and analytics

```ts
// apps/api/src/modules/admin/orders.admin.ts (excerpt)
import { Router } from "express";
import { z } from "zod";
import { ORDER_TRANSITIONS, OrderStatus } from "@hp/contracts";
import { requirePermission } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/errors";
import { ok } from "../../lib/respond";
import { queue } from "../../lib/queue";

const StatusBody = z.object({
  status: OrderStatus.exclude(["CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"]), // those have dedicated endpoints
  trackingNumber: z.string().max(64).optional(),
  note: z.string().max(500).optional(),
});

export const ordersAdmin = Router();

ordersAdmin.patch("/:id/status", requirePermission("order:write"), validate({ body: StatusBody }), async (req, res) => {
  const { status, trackingNumber, note } = req.body as z.infer<typeof StatusBody>;
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  if (!ORDER_TRANSITIONS[order.status].includes(status)) {
    throw new AppError("CONFLICT", `An order that is ${order.status} can't be marked ${status}.`);
  }
  if (status === "SHIPPED" && !trackingNumber) {
    throw new AppError("VALIDATION_ERROR", "Add a tracking number to mark the order as shipped.");
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      status,
      trackingNumber: trackingNumber ?? order.trackingNumber,
      events: { create: { type: "status_changed", fromStatus: order.status, toStatus: status, message: note, actorId: req.user!.sub } },
    },
  });
  if (status === "SHIPPED") await queue.add("email", { template: "shipped", orderId: order.id });
  res.json(ok(updated));
});
```

```ts
// apps/api/src/modules/admin/analytics.admin.ts (excerpt)
const Range = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  interval: z.enum(["day", "week", "month"]).default("day"),
});

analyticsAdmin.get("/sales-timeseries", requirePermission("analytics:read"), validate({ query: Range }), async (req, res) => {
  const { from, to, interval } = Range.parse(req.query);
  const rows = await prisma.$queryRaw<{ bucket: Date; orders: bigint; revenue: bigint; aov: number }[]>`
    SELECT date_trunc(${interval}, "paidAt") AS bucket,
           COUNT(*)            AS orders,
           SUM("totalCents")   AS revenue,
           AVG("totalCents")::int AS aov
    FROM "Order"
    WHERE "paidAt" BETWEEN ${from} AND ${to}
      AND status NOT IN ('CANCELLED', 'PENDING_PAYMENT', 'REFUNDED')
    GROUP BY 1 ORDER BY 1`;
  res.json(ok(rows.map((r) => ({
    bucket: r.bucket, orders: Number(r.orders), revenueCents: Number(r.revenue), aovCents: r.aov,
  }))));
});
```

`/analytics/summary` returns revenue, orders, average order value, refund rate, new vs returning customers, gross margin (from `costCents`) and low-stock SKU count, each with the previous-period value for comparison.

### 4.11 Presigned image upload

```ts
// apps/api/src/modules/admin/uploads.admin.ts (excerpt)
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PRESIGN_TTL_SECONDS = 300;

const Presign = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  contentLength: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

uploadsAdmin.post("/presign", requirePermission("product:write"), validate({ body: Presign }), async (req, res) => {
  const { contentType, contentLength } = req.body as z.infer<typeof Presign>;
  const ext = contentType.split("/")[1];
  const key = `products/${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;   // key is server-generated
  const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
    Bucket: env.R2_BUCKET, Key: key, ContentType: contentType, ContentLength: contentLength,
  }), { expiresIn: PRESIGN_TTL_SECONDS });
  res.json(ok({ uploadUrl, key, publicUrl: `${env.CDN_BASE_URL}/${key}` }));
});
```

### 4.12 Typed API client (used by Agents 2 and 3)

```ts
// packages/api-client/src/index.ts
import type { z } from "zod";
import type { ApiError, PageMeta } from "@hp/contracts";

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly error: z.infer<typeof ApiError>) {
    super(error.message);
  }
}

type TokenSource = { get(): string | null; refresh(): Promise<string | null> };
type Result<T> = { data: T; meta?: z.infer<typeof PageMeta> };

export function createApiClient(baseUrl: string, tokens?: TokenSource) {
  async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<Result<T>> {
    const token = tokens?.get();
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (res.status === 401 && tokens && !retried && (await tokens.refresh())) {
      return request<T>(path, init, true);
    }
    const body = await res.json();
    if (!body.success) throw new ApiClientError(res.status, body.error);
    return { data: body.data as T, meta: body.meta };
  }

  return {
    get:    <T>(path: string) => request<T>(path),
    post:   <T>(path: string, body?: unknown, headers?: HeadersInit) =>
              request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}), headers }),
    patch:  <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}
```

### 4.13 Backend definition of done

- Every endpoint in 3.4 is implemented and appears in the generated OpenAPI document.
- `prisma migrate deploy` runs cleanly on an empty database; the seed creates the demo catalog and one SUPER_ADMIN from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
- Unit coverage ≥ 85% on pricing, tokens, RBAC and order transitions; integration tests green.
- No SQL is built by string concatenation; every input is validated by Zod at the route.

---

## 5. Agent 2 — Frontend Developer (Customer Storefront)

**Owns:** `apps/web`, `packages/ui`.
**Depends on:** `packages/contracts` + `packages/api-client` (Day 2) and a running API with seed data (Day 3). Until then, builds against MSW mocks typed by the contract.

### 5.1 File structure

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                      # header, footer, cart drawer provider
│   │   ├── page.tsx                        # home: hero, featured categories, best sellers
│   │   ├── (shop)/
│   │   │   ├── shop/page.tsx               # all products: search + filters (URL is the state)
│   │   │   ├── c/[category]/page.tsx       # category listing (ISR, revalidate 300)
│   │   │   └── p/[slug]/page.tsx           # product detail (ISR, revalidate 60) + JSON-LD
│   │   ├── cart/page.tsx
│   │   ├── checkout/
│   │   │   ├── page.tsx                    # address → shipping → payment
│   │   │   └── complete/page.tsx           # handles Stripe return_url, polls order status
│   │   ├── account/
│   │   │   ├── layout.tsx                  # auth guard
│   │   │   ├── page.tsx  orders/page.tsx  orders/[number]/page.tsx
│   │   │   └── addresses/page.tsx  wishlist/page.tsx  settings/page.tsx
│   │   ├── (auth)/ login/ register/ forgot-password/ reset-password/ verify-email/
│   │   └── sitemap.ts  robots.ts  not-found.tsx  error.tsx
│   ├── components/
│   │   ├── catalog/  ProductCard ProductGrid FilterSidebar SortSelect Pagination PriceTag
│   │   ├── product/  Gallery VariantPicker AddToCartButton SpecsTable Reviews
│   │   ├── cart/     CartDrawer CartLine CouponForm OrderSummary
│   │   ├── checkout/ AddressForm ShippingOptions PaymentStep
│   │   └── layout/   Header SearchBox MegaMenu Footer
│   ├── lib/
│   │   ├── api.ts            # server + browser instances of createApiClient
│   │   ├── auth-store.ts     # in-memory access token + silent refresh
│   │   ├── cart.ts           # TanStack Query hooks for the cart
│   │   ├── format.ts         # formatMoney(cents)
│   │   └── analytics.ts      # view_item, add_to_cart, begin_checkout, purchase events
│   └── mocks/                # MSW handlers for development before the API is ready
├── next.config.ts
└── package.json
```

### 5.2 Key code

```ts
// apps/web/src/lib/format.ts
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatMoney = (cents: number) => usd.format(cents / 100);
```

```tsx
// apps/web/src/app/(shop)/shop/page.tsx — server component; the URL holds all filter state
import { ProductQuery, type ProductSummary } from "@hp/contracts";
import { serverApi } from "@/lib/api";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { FilterSidebar } from "@/components/catalog/FilterSidebar";
import { Pagination } from "@/components/catalog/Pagination";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toQueryString(query: ProductQuery) {
  const pairs = Object.entries(query).flatMap(([key, value]) =>
    value == null ? [] : Array.isArray(value) ? value.map((v) => [key, String(v)]) : [[key, String(value)]]);
  return new URLSearchParams(pairs).toString();
}

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const parsed = ProductQuery.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : ProductQuery.parse({});   // bad params fall back to defaults
  const qs = toQueryString(query);

  const [{ data: products, meta }, { data: facets }] = await Promise.all([
    serverApi.get<ProductSummary[]>(`/products?${qs}`),
    serverApi.get<Facets>(`/products/facets?${qs}`),
  ]);

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 md:grid-cols-[260px_1fr]">
      <FilterSidebar facets={facets} active={query} />
      <section aria-label="Products">
        <p className="text-sm text-muted">{meta!.total} items</p>
        <ProductGrid products={products} />
        <Pagination page={meta!.page} totalPages={meta!.totalPages} />
      </section>
    </div>
  );
}
```

```tsx
// apps/web/src/app/(shop)/p/[slug]/page.tsx — ISR + SEO
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ProductDetail } from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import { serverApi } from "@/lib/api";

export const revalidate = 60;
type Params = Promise<{ slug: string }>;

async function getProduct(slug: string) {
  try {
    return (await serverApi.get<ProductDetail>(`/products/${encodeURIComponent(slug)}`)).data;
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) return null;
    throw err;                                   // real failures go to error.tsx, not a fake 404
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const product = await getProduct((await params).slug);
  if (!product) return {};
  const plain = product.description.replace(/<[^>]+>/g, "");
  return {
    title: `${product.name} | Hearth & Pan`,
    description: plain.slice(0, 155),
    openGraph: { images: product.images.slice(0, 1).map((i) => i.url) },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const product = await getProduct((await params).slug);
  if (!product) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: product.images.map((i) => i.url),
    sku: product.variants[0]?.sku,
    aggregateRating: product.ratingCount
      ? { "@type": "AggregateRating", ratingValue: product.ratingAvg, reviewCount: product.ratingCount }
      : undefined,
    offers: product.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      price: (v.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: v.stockAvailable > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    })),
  };

  return (
    <>
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {/* <Gallery/> <VariantPicker/> <AddToCartButton/>
          <SpecsTable/>: material, capacity, diameter, oven-safe °F, induction, dishwasher
          <Reviews/> */}
    </>
  );
}
```

```tsx
// apps/web/src/components/checkout/PaymentStep.tsx
"use client";
import { useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export function PaymentStep({ clientSecret, orderNumber }: { clientSecret: string; orderNumber: string }) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <PayForm orderNumber={orderNumber} />
    </Elements>
  );
}

function PayForm({ orderNumber }: { orderNumber: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/checkout/complete?order=${orderNumber}` },
    });
    // Reached only on an immediate failure; success redirects to return_url.
    setError(error.message ?? "Your payment couldn't be processed. Try another card.");
    setSubmitting(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={!stripe || submitting} className="btn-primary w-full" data-testid="pay-now">
        {submitting ? "Processing…" : "Pay now"}
      </button>
    </form>
  );
}
```

`/checkout/complete` does **not** trust the redirect alone. It polls the order (customer endpoint, or the guest lookup endpoint with the token) until the status is `PAID`, showing "Confirming your payment…" for up to 30 seconds, then a "We're still confirming; we'll email you" message.

### 5.3 Storefront requirements

- **Responsive:** 360px to 1440px; filters collapse into a bottom sheet on mobile.
- **Performance budget:** LCP < 2.5s on 4G, CLS < 0.1, INP < 200ms, < 170 KB gzipped JS on product pages. Next/Image with a custom R2 loader, AVIF/WebP.
- **Accessibility:** WCAG 2.2 AA. Keyboard-operable variant picker and cart drawer (focus trap, Escape closes), visible focus, labelled fields, errors linked with `aria-describedby`.
- **Cart:** guest cart via signed cookie, merged on login via `POST /cart/merge`; optimistic quantity updates that roll back on `OUT_OF_STOCK`.
- **Search:** debounced type-ahead (250ms) against `/products?q=…&pageSize=6`.
- **Kitchen-specific UX:** spec table (material, capacity in qt/L, diameter in in/cm, oven-safe temperature, induction and dishwasher icons), "Fits with" cross-sells (lids for pans, blocks for knives), care-guide tab.
- **SEO:** `sitemap.ts` lists categories and active products; canonical URLs drop filter params; breadcrumbs with JSON-LD.

---

## 6. Agent 3 — Admin Dashboard Developer

**Owns:** `apps/admin`.
**Depends on:** contracts (Day 2) and admin endpoints (Days 8–13). Builds against MSW mocks until each endpoint lands.

### 6.1 File structure

```
apps/admin/
├── src/
│   ├── app/
│   │   ├── login/page.tsx              # email + password
│   │   ├── login/2fa/page.tsx          # TOTP code; enrollment QR + recovery codes on first login
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx              # sidebar filtered by can(), session guard, 30-min idle timeout
│   │   │   ├── page.tsx                # Overview: KPI cards, revenue chart, recent orders, low stock
│   │   │   ├── products/ page.tsx  new/page.tsx  [id]/page.tsx
│   │   │   ├── categories/page.tsx
│   │   │   ├── orders/ page.tsx  [id]/page.tsx
│   │   │   ├── customers/ page.tsx  [id]/page.tsx
│   │   │   ├── inventory/page.tsx      # stock table, inline adjust, movement history drawer
│   │   │   ├── coupons/ page.tsx  new/page.tsx  [id]/page.tsx
│   │   │   ├── analytics/page.tsx      # date range, charts, top products, export
│   │   │   ├── reports/page.tsx        # export jobs with download links
│   │   │   ├── staff/page.tsx          # SUPER_ADMIN only
│   │   │   └── audit-log/page.tsx      # SUPER_ADMIN only
│   ├── components/
│   │   ├── data-table/ DataTable ColumnFilters BulkActions      # TanStack Table, server-side paging
│   │   ├── products/   ProductForm VariantsEditor ImageUploader RichTextEditor (Tiptap)
│   │   ├── orders/     OrderTimeline StatusTransitionMenu RefundDialog PackingSlip
│   │   ├── charts/     RevenueChart OrdersBarChart TopProductsTable KpiCard
│   │   ├── Can.tsx
│   │   └── ui/         # shadcn/ui components
│   ├── lib/ api.ts session.ts csv.ts
│   └── middleware.ts   # redirects signed-out users to /login
├── next.config.ts      # strict CSP, X-Frame-Options DENY, X-Robots-Tag noindex
└── package.json
```

### 6.2 Admin-specific security

- Separate origin (`admin.hearthandpan.com`), `noindex`, `X-Frame-Options: DENY`, strict CSP.
- Recommended: Cloudflare Access (Zero Trust) in front of the admin domain, so only staff identities can load the page at all.
- 2FA required for every admin role; recovery codes generated at enrollment and stored hashed.
- Idle logout after 30 minutes; refresh lifetime 8 hours; logout revokes the token family.
- Destructive actions (delete product, refund, role change) need a typed confirmation and are written to the audit log with before/after JSON.

### 6.3 Key code

```tsx
// apps/admin/src/components/Can.tsx
"use client";
import { can, type Permission } from "@hp/contracts";
import { useSession } from "@/lib/session";

export function Can({ perm, children, fallback = null }: {
  perm: Permission; children: React.ReactNode; fallback?: React.ReactNode;
}) {
  const { user } = useSession();
  return user && can(user.role, perm) ? <>{children}</> : <>{fallback}</>;
}
```

```tsx
// apps/admin/src/components/products/ImageUploader.tsx
"use client";
import { useState } from "react";
import { adminApi } from "@/lib/api";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif"];

type Presigned = { uploadUrl: string; key: string; publicUrl: string };

export function ImageUploader({ onUploaded }: { onUploaded: (img: { key: string; url: string }) => void }) {
  const [status, setStatus] = useState<string | null>(null);

  async function upload(file: File) {
    if (!ACCEPTED.includes(file.type)) return setStatus("Use a JPG, PNG, WebP or AVIF image.");
    if (file.size > MAX_BYTES) return setStatus("Images must be 8 MB or smaller.");
    setStatus(`Uploading ${file.name}…`);
    try {
      const { data } = await adminApi.post<Presigned>("/admin/uploads/presign",
        { contentType: file.type, contentLength: file.size });
      const put = await fetch(data.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status}). Try again.`);
      onUploaded({ key: data.key, url: data.publicUrl });
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed. Try again.");
    }
  }

  return (
    <label className="flex cursor-pointer flex-col items-center gap-2 rounded border border-dashed p-6 text-sm">
      <span>Drop product photos here or click to choose</span>
      <input id="product-images" type="file" accept={ACCEPTED.join(",")} multiple className="sr-only"
        onChange={(e) => Array.from(e.target.files ?? []).forEach(upload)} />
      {status && <span role="status">{status}</span>}
    </label>
  );
}
```

```tsx
// apps/admin/src/components/orders/StatusTransitionMenu.tsx
"use client";
import { ORDER_TRANSITIONS, type OrderStatus } from "@hp/contracts";
import { Can } from "@/components/Can";

const DEDICATED_ACTIONS: OrderStatus[] = ["CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"]; // own dialogs
const label = (s: OrderStatus) => s.toLowerCase().replace(/_/g, " ");

export function StatusTransitionMenu({ status, onChange }: { status: OrderStatus; onChange: (s: OrderStatus) => void }) {
  const next = ORDER_TRANSITIONS[status].filter((s) => !DEDICATED_ACTIONS.includes(s));
  if (next.length === 0) return null;
  return (
    <Can perm="order:write">
      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <button key={s} type="button" className="btn-secondary" onClick={() => onChange(s)}>
            Mark as {label(s)}
          </button>
        ))}
      </div>
    </Can>
  );
}
```

```tsx
// apps/admin/src/components/charts/RevenueChart.tsx
"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const shortDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function RevenueChart({ data }: { data: { bucket: string; revenueCents: number; orders: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={shortDate} />
        <YAxis tickFormatter={money} width={72} />
        <Tooltip formatter={(v: number) => money(v)} labelFormatter={shortDate} />
        <Area type="monotone" dataKey="revenueCents" name="Revenue" strokeWidth={2} fillOpacity={0.15} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

```ts
// apps/admin/src/lib/csv.ts — small client-side exports; large ones go through /admin/reports (worker)
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const escapeCell = (value: unknown) => {
  const raw = value == null ? "" : String(value);
  const safe = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;          // block CSV formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = <T extends Record<string, unknown>>(rows: T[], columns: (keyof T & string)[]) =>
  [columns.join(","), ...rows.map((row) => columns.map((c) => escapeCell(row[c])).join(","))].join("\n");
```

### 6.4 Admin feature checklist

| Area | Must have |
|---|---|
| Overview | KPI cards (revenue, orders, AOV, refund rate) with % change vs previous period; 30-day revenue chart; latest 10 orders; low-stock list |
| Products | Server-paged table with search and status/category/stock filters; bulk publish/archive; form with variants editor (SKU, price, compare-at, cost, stock, attributes), drag-to-reorder images, rich-text description, kitchen spec fields, preview link |
| Orders | Filter by status/date/total/customer; detail with items, addresses, Stripe payment link, timeline, internal notes; status transitions; cancel (releases stock); full/partial refund dialog; printable packing slip |
| Customers | List; detail with order history and lifetime value; disable account |
| Inventory | Per-variant on-hand / reserved / available; inline adjust with reason; movement ledger; per-SKU low-stock threshold; CSV import for restocks |
| Coupons | Percent / fixed / free-shipping; minimum subtotal; date window; usage limits; category restriction; redemption count |
| Analytics | Date range with presets; revenue and orders charts; top products; sales by category; new vs returning; CSV/XLSX export via job queue |
| Staff & audit | SUPER_ADMIN manages roles; searchable audit log with before/after diff |

---

## 7. Agent 4 — DevOps & Deployment

**Owns:** `infra/`, `.github/workflows/`, `packages/config`, Dockerfiles, environments, DNS, secrets, monitoring.
**Delivers first:** the local stack (Day 1) so other agents can start.

### 7.1 File structure

```
infra/
├── docker-compose.yml        # postgres, redis, mailpit, stripe-cli for local dev
├── render.yaml               # Render blueprint: api, worker, postgres, redis
└── scripts/
    ├── bootstrap.sh          # first-time local setup
    ├── smoke.sh              # post-deploy checks
    └── backup-verify.sh      # weekly restore of latest backup into a scratch DB
apps/api/Dockerfile
apps/worker/Dockerfile
.github/workflows/ ci.yml  deploy.yml  nightly.yml
.env.example                  # every variable, placeholder values only
```

### 7.2 Local development

```yaml
# infra/docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: hp
      POSTGRES_PASSWORD: hp_local_dev_only
      POSTGRES_DB: hearthandpan
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U hp"], interval: 5s, retries: 10 }
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  mailpit:
    image: axllent/mailpit:latest
    ports: ["8025:8025", "1025:1025"]          # catch-all SMTP + web UI for dev emails
  stripe-cli:
    image: stripe/stripe-cli:latest
    command: listen --forward-to host.docker.internal:4000/api/v1/webhooks/stripe
    environment: { STRIPE_API_KEY: "${STRIPE_SECRET_KEY}" }
    extra_hosts: ["host.docker.internal:host-gateway"]
volumes:
  pgdata: {}
```

```bash
#!/usr/bin/env bash
# infra/scripts/bootstrap.sh
set -euo pipefail
corepack enable
pnpm install
[ -f .env ] || cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis mailpit
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed
echo "Ready. Run 'pnpm dev' — web :3000, admin :3001, api :4000, mail UI :8025"
```

### 7.3 API Dockerfile

```dockerfile
# apps/api/Dockerfile — build from repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter api...
RUN pnpm --filter api exec prisma generate && pnpm --filter api... build
RUN pnpm --filter api deploy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4000/api/v1/health || exit 1
CMD ["node", "dist/server.js"]
```

### 7.4 Render blueprint

```yaml
# infra/render.yaml
services:
  - type: web
    name: hp-api
    runtime: docker
    dockerfilePath: ./apps/api/Dockerfile
    dockerContext: .
    region: oregon
    plan: standard
    healthCheckPath: /api/v1/health
    preDeployCommand: npx prisma migrate deploy --schema prisma/schema.prisma
    autoDeploy: false                    # GitHub Actions triggers deploys after CI passes
    scaling: { minInstances: 2, maxInstances: 6, targetCPUPercent: 70 }
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: hp-db, property: connectionString }
      - key: REDIS_URL
        fromService: { type: keyvalue, name: hp-redis, property: connectionString }
      - fromGroup: hp-api-secrets        # JWT / Stripe / R2 / Resend keys, set in the dashboard
  - type: worker
    name: hp-worker
    runtime: docker
    dockerfilePath: ./apps/worker/Dockerfile
    dockerContext: .
    region: oregon
    autoDeploy: false
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: hp-db, property: connectionString }
      - key: REDIS_URL
        fromService: { type: keyvalue, name: hp-redis, property: connectionString }
      - fromGroup: hp-api-secrets
  - type: keyvalue
    name: hp-redis
    region: oregon
    plan: starter
    ipAllowList: []                      # private network only
databases:
  - name: hp-db
    region: oregon
    plan: pro-4gb
    postgresMajorVersion: "16"
    ipAllowList: []
```

Check plan names against Render's current catalog when you apply the blueprint; they change occasionally.

### 7.5 CI and CD pipelines

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push: { branches: [main] }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint typecheck
      - run: pnpm turbo test -- --coverage
      - run: pnpm audit --prod --audit-level=high
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }

  integration:
    runs-on: ubuntu-latest
    needs: quality
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: hp, POSTGRES_PASSWORD: hp, POSTGRES_DB: hp_test }
        ports: ["5432:5432"]
        options: --health-cmd "pg_isready -U hp" --health-interval 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    env:
      DATABASE_URL: postgresql://hp:hp@localhost:5432/hp_test
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter api exec prisma migrate deploy
      - run: pnpm --filter api test:int

  e2e:
    runs-on: ubuntu-latest
    needs: integration
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: docker compose -f infra/docker-compose.yml up -d postgres redis mailpit
      - run: pnpm --filter api exec prisma migrate deploy && pnpm --filter api exec prisma db seed
      - run: pnpm exec playwright install --with-deps chromium webkit
      - run: pnpm turbo build --filter=api --filter=web --filter=admin
      - run: pnpm e2e
        env:
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_TEST_SECRET_KEY }}
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ${{ secrets.STRIPE_TEST_PUBLISHABLE_KEY }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: e2e/playwright-report }
```

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  workflow_run: { workflows: [CI], types: [completed], branches: [main] }
jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    environment: production              # manual approval configured in GitHub
    steps:
      - uses: actions/checkout@v4
      - name: Deploy API + worker (Render runs migrations in preDeployCommand)
        run: |
          curl -fsS -X POST "${{ secrets.RENDER_API_DEPLOY_HOOK }}"
          curl -fsS -X POST "${{ secrets.RENDER_WORKER_DEPLOY_HOOK }}"
      - name: Wait for API health
        run: |
          for i in $(seq 1 40); do
            curl -fsS https://api.hearthandpan.com/api/v1/health && exit 0
            sleep 15
          done
          exit 1
      - name: Deploy storefront + admin to Vercel
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
        run: |
          VERCEL_PROJECT_ID=${{ secrets.VERCEL_WEB_PROJECT_ID }}   npx vercel@latest deploy --prod --token="$VERCEL_TOKEN"
          VERCEL_PROJECT_ID=${{ secrets.VERCEL_ADMIN_PROJECT_ID }} npx vercel@latest deploy --prod --token="$VERCEL_TOKEN"
      - run: bash infra/scripts/smoke.sh https://api.hearthandpan.com https://www.hearthandpan.com
```

### 7.6 Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | api, worker | Injected by Render |
| `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER` | api | `openssl rand -base64 48`; different per environment |
| `TOTP_ENCRYPTION_KEY` | api | `openssl rand -hex 32` |
| `CORS_ORIGINS` | api | `https://www.hearthandpan.com,https://admin.hearthandpan.com` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | api | Test keys in staging; live keys only in production |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CDN_BASE_URL` | api, worker | R2 token scoped to the one bucket |
| `RESEND_API_KEY`, `MAIL_FROM` | worker | Sending domain verified with SPF / DKIM / DMARC |
| `SENTRY_DSN` | all | One Sentry project per app |
| `NEXT_PUBLIC_API_URL` | web, admin | `https://api.hearthandpan.com/api/v1` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | web | `pk_…` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed only | Remove after the first production seed; forced password change + 2FA on first login |

Secrets live only in Render env groups, Vercel project settings and GitHub Actions secrets. `.env` is git-ignored and gitleaks runs on every PR.

### 7.7 Step-by-step production deployment

1. **Accounts:** GitHub repo, Vercel team, Render workspace, Cloudflare, Stripe (complete business verification), Resend, Sentry, Better Stack.
2. **Domain:** register or transfer `hearthandpan.com` and point its nameservers to Cloudflare.
3. **Database & Redis:** in Render choose **New → Blueprint** and select `infra/render.yaml`. This creates `hp-db`, `hp-redis`, `hp-api` and `hp-worker`. Turn on daily backups and point-in-time recovery for `hp-db`.
4. **Secrets:** create env group `hp-api-secrets` in Render with every API secret from 7.6.
5. **First migration + seed:** the first deploy runs `prisma migrate deploy`. Then run the seed once from the Render shell (`npx prisma db seed`) and delete `SEED_ADMIN_PASSWORD` afterwards.
6. **API domain:** add custom domain `api.hearthandpan.com` in Render; add the CNAME it shows in Cloudflare. Set Cloudflare SSL/TLS mode to **Full (strict)**.
7. **Images:** create R2 bucket `hp-product-images`, attach custom domain `cdn.hearthandpan.com`, add a CORS rule allowing `PUT` from `https://admin.hearthandpan.com` only.
8. **Vercel:** import the repo twice: project `hp-web` (root `apps/web`) and `hp-admin` (root `apps/admin`). Set their env vars. Add domains `www.hearthandpan.com` (apex redirects to www) and `admin.hearthandpan.com`, and create the CNAMEs in Cloudflare as **DNS only** so Vercel issues the certificates.
9. **Stripe webhook:** Developers → Webhooks → add `https://api.hearthandpan.com/api/v1/webhooks/stripe` for `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`. Register `www.hearthandpan.com` as an Apple Pay domain.
10. **Email:** verify the sending domain in Resend; add SPF, DKIM and a DMARC record (`p=quarantine`) in Cloudflare.
11. **Hardening:** enable Cloudflare WAF managed rules; add an edge rate-limit rule on `/api/v1/auth/*`; optionally add a Cloudflare Access policy on `admin.`; set HSTS with `max-age=31536000; includeSubDomains`.
12. **Monitoring:** Sentry DSNs in every app; Better Stack uptime checks on `/api/v1/health`, the home page and one product page; Stripe webhook failure alerts on.
13. **Go-live gate:** run `infra/scripts/smoke.sh`; place one real order with a live card and refund it; confirm the email arrives, stock decrements and the admin shows the order and refund.

```bash
#!/usr/bin/env bash
# infra/scripts/smoke.sh <api-base> <web-base>
set -euo pipefail
API="$1"; WEB="$2"
curl -fsS "$API/api/v1/health" | grep -q '"db":"ok"'
curl -fsS "$API/api/v1/products?pageSize=1" | grep -q '"success":true'
[ "$(curl -s -o /dev/null -w '%{http_code}' "$WEB/")" = "200" ]
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/v1/admin/orders")
[ "$code" = "401" ] || { echo "Admin endpoint not protected (got $code)"; exit 1; }
echo "Smoke tests passed"
```

### 7.8 Operations

- **Migrations:** expand → migrate data → contract. Never drop a column in the same release that stops using it.
- **Rollback:** Vercel "Promote previous deployment"; Render "Rollback". Because migrations are additive, the previous API build still runs on the new schema.
- **Backups:** Render daily backups + 7-day PITR; `backup-verify.sh` restores weekly into a scratch DB and checks row counts.
- **Environments:** preview (per PR), staging (Stripe test mode, nightly E2E), production.

---

## 8. Agent 5 — Testing & QA

**Owns:** `apps/*/test`, `e2e/`, `packages/test-utils`, the test plan and coverage reports.
**Works alongside every phase:** writes tests from the contract before or alongside implementation, not after.

### 8.1 Test plan

| Layer | Tool | Scope | Target |
|---|---|---|---|
| Unit | Vitest (+ Testing Library) | Pricing, coupon rules, `can()`, order transitions, token rotation, CSV escaping, React components | ≥ 85% lines on API services and pure libs; ≥ 80% overall |
| Integration | Vitest + Supertest + Postgres | Every route in 3.4: happy path, validation error, auth/permission failure | Every endpoint has ≥ 3 tests |
| Contract | Zod | Integration tests parse every response with the contract schema | Any drift fails CI |
| E2E | Playwright (Chromium desktop + WebKit mobile) | The 8 critical paths below | All pass on every PR to `main` |
| Security | OWASP ZAP baseline (nightly), `pnpm audit`, gitleaks | Headers, injection, secrets | No high findings |
| Performance | k6 | `/products` search p95 < 300ms at 50 rps; `/checkout/intent` p95 < 800ms | Before launch, then monthly |
| Accessibility | axe-core in Playwright | Home, listing, PDP, cart, checkout, admin login | 0 serious/critical violations |

**Critical paths (E2E):**

1. Register → verify email (via the Mailpit API) → sign in.
2. Search with a typo ("skilet") finds "Cast Iron Skillet"; filter by material and price.
3. Guest adds to cart → changes quantity → applies coupon → signs in → cart merges.
4. Checkout with Stripe test card `4242 4242 4242 4242` → confirmation → order appears in account history.
5. Checkout with declined test card `4000 0000 0000 0002` shows an error; no order becomes PAID.
6. Out-of-stock race: two browser contexts buy the last unit; exactly one succeeds.
7. Admin signs in with password + TOTP → creates a product with an image → it appears on the storefront.
8. Admin marks an order shipped with tracking → customer sees it; a STAFF user can't refund (button hidden, API returns 403).

### 8.2 Unit test example

```ts
// apps/api/src/modules/cart/pricing.test.ts
import { describe, it, expect } from "vitest";
import { computeTotals, FREE_SHIPPING_THRESHOLD_CENTS } from "./pricing";

const pan = { unitPriceCents: 4_999, quantity: 1, categoryId: "cookware" };
const knife = { unitPriceCents: 8_900, quantity: 1, categoryId: "knives" };

describe("computeTotals", () => {
  it("charges shipping below the free-shipping threshold", () => {
    const totals = computeTotals([pan], 799, 0);
    expect(totals).toMatchObject({ subtotalCents: 4_999, shippingCents: 799, totalCents: 5_798 });
  });

  it("waives shipping at the threshold", () => {
    const totals = computeTotals([{ ...pan, unitPriceCents: FREE_SHIPPING_THRESHOLD_CENTS }], 799, 0);
    expect(totals.shippingCents).toBe(0);
  });

  it("applies a percent coupon only to eligible categories", () => {
    const coupon = { type: "PERCENT" as const, value: 10, minSubtotalCents: 0, categoryIds: ["knives"] };
    expect(computeTotals([pan, knife], 0, 0, coupon).discountCents).toBe(890);
  });

  it("caps a fixed coupon at the eligible subtotal", () => {
    const coupon = { type: "FIXED" as const, value: 10_000, minSubtotalCents: 0, categoryIds: [] };
    expect(computeTotals([pan], 0, 0, coupon).discountCents).toBe(4_999);
  });

  it("ignores a coupon when the minimum subtotal isn't met", () => {
    const coupon = { type: "PERCENT" as const, value: 20, minSubtotalCents: 10_000, categoryIds: [] };
    expect(computeTotals([pan], 0, 0, coupon).discountCents).toBe(0);
  });

  it("taxes the discounted subtotal and keeps totals consistent", () => {
    const coupon = { type: "FIXED" as const, value: 1_000, minSubtotalCents: 0, categoryIds: [] };
    const totals = computeTotals([pan], 799, 825, coupon);          // 8.25%
    expect(totals.taxCents).toBe(330);
    expect(totals.totalCents).toBe(totals.subtotalCents - totals.discountCents + totals.shippingCents + totals.taxCents);
  });
});
```

### 8.3 Integration test example

```ts
// apps/api/test/checkout.int.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { z } from "zod";
import { envelope } from "@hp/contracts";
import { resetDb, createProduct, guestCartCookie, accessTokenFor, prismaTest } from "@hp/test-utils";
import { createApp } from "../src/app";

vi.mock("../src/lib/stripe", () => ({
  stripe: { paymentIntents: { create: vi.fn().mockResolvedValue({ id: "pi_test_1", client_secret: "pi_test_1_secret" }) } },
}));

const app = createApp();
const address = { fullName: "Ada Cook", line1: "1 Market St", city: "San Francisco", region: "CA", postalCode: "94105", country: "US" };
const checkoutBody = { email: "ada@example.com", shippingAddress: address, shippingMethod: "standard" };

describe("POST /api/v1/checkout/intent", () => {
  beforeEach(resetDb);

  it("reserves stock and returns a client secret", async () => {
    const { variant } = await createProduct({ stockOnHand: 3, priceCents: 4_999 });
    const cookie = await guestCartCookie(app, [{ variantId: variant.id, quantity: 2 }]);

    const res = await request(app).post("/api/v1/checkout/intent").set("Cookie", cookie).send(checkoutBody);

    expect(res.status).toBe(200);
    envelope(z.object({ clientSecret: z.string(), orderNumber: z.string() }).passthrough()).parse(res.body);
    const after = await prismaTest.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockReserved).toBe(2);
  });

  it("returns 409 OUT_OF_STOCK when quantity exceeds available stock", async () => {
    const { variant } = await createProduct({ stockOnHand: 1 });
    const cookie = await guestCartCookie(app, [{ variantId: variant.id, quantity: 2 }]);
    const res = await request(app).post("/api/v1/checkout/intent").set("Cookie", cookie).send(checkoutBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "OUT_OF_STOCK", details: { available: 1 } });
  });

  it("sells the last unit to exactly one of two concurrent buyers", async () => {
    const { variant } = await createProduct({ stockOnHand: 1 });
    const cookies = await Promise.all([1, 2].map(() => guestCartCookie(app, [{ variantId: variant.id, quantity: 1 }])));
    const results = await Promise.all(cookies.map((c) =>
      request(app).post("/api/v1/checkout/intent").set("Cookie", c).send(checkoutBody)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe("admin RBAC", () => {
  it("returns 403 when STAFF attempts a refund", async () => {
    const token = await accessTokenFor({ role: "STAFF", tfa: true });
    const res = await request(app).post("/api/v1/admin/orders/o1/refund")
      .set("Authorization", `Bearer ${token}`).send({ amountCents: 100 });
    expect(res.status).toBe(403);
  });

  it("returns 403 for an admin token without 2FA", async () => {
    const token = await accessTokenFor({ role: "ADMIN", tfa: false });
    const res = await request(app).get("/api/v1/admin/orders").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 401 with no token", async () => {
    expect((await request(app).get("/api/v1/admin/orders")).status).toBe(401);
  });
});
```

### 8.4 E2E examples

```ts
// e2e/checkout.spec.ts
import { test, expect } from "@playwright/test";

test("guest can search, add to cart and pay with a test card", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search products" }).fill("skilet");
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: /Cast Iron Skillet/ }).first().click();

  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Checkout" }).click();

  await page.getByLabel("Email").fill(`e2e+${Date.now()}@example.com`);
  await page.getByLabel("Full name").fill("Ada Cook");
  await page.getByLabel("Address").fill("1 Market St");
  await page.getByLabel("City").fill("San Francisco");
  await page.getByLabel("State").selectOption("CA");
  await page.getByLabel("ZIP code").fill("94105");
  await page.getByRole("button", { name: "Continue to payment" }).click();

  const card = page.frameLocator('iframe[title="Secure payment input frame"]');
  await card.getByLabel("Card number").fill("4242424242424242");
  await card.getByLabel("Expiration").fill("12/34");
  await card.getByLabel("Security code").fill("123");
  await card.getByLabel("ZIP").fill("94105");
  await page.getByTestId("pay-now").click();

  await expect(page.getByRole("heading", { name: "Thanks for your order" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/HP-\d{4}-\d{6}/)).toBeVisible();
});
```

```ts
// e2e/admin-login.spec.ts
import { test, expect } from "@playwright/test";
import { authenticator } from "otplib";

// Uses the test-only admin seeded into the CI database; values come from CI secrets.
test("admin signs in with password and TOTP", async ({ page }) => {
  await page.goto(`${process.env.ADMIN_URL}/login`);
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByLabel("Authentication code").fill(authenticator.generate(process.env.E2E_ADMIN_TOTP_SECRET!));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("admin sign-in rejects a wrong TOTP code", async ({ page }) => {
  // ...same first step, then fill "000000" and expect: "That code didn't work. Check your authenticator app."
});
```

### 8.5 Coverage configuration and report

```ts
// apps/api/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/**/*.d.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
```

QA publishes a coverage report per release at `docs/qa/coverage-<version>.md`:

| Package | Lines | Branches | Functions | Gate |
|---|---|---|---|---|
| apps/api | ≥ 85% | ≥ 75% | ≥ 85% | blocks release |
| apps/worker | ≥ 80% | ≥ 70% | ≥ 80% | blocks release |
| apps/web | ≥ 70% (components + lib) | — | — | blocks release |
| apps/admin | ≥ 70% | — | — | blocks release |
| packages/contracts | ≥ 95% | — | — | blocks release |
| E2E critical paths | 8 / 8 passing | | | blocks release |

Each report also lists new tests, quarantined flaky tests (with issue links), open defects by severity, and the latest k6 and axe results.

---

## 9. Orchestrated build plan

Durations assume one engineer or agent per role working in parallel. A task can't start until everything in its "Depends on" column is done.

### Phase 0 — Foundations (Days 1–2)

| # | Task | Agent | Depends on | Output |
|---|---|---|---|---|
| 0.1 | Monorepo, Turborepo, pnpm, shared tsconfig / eslint / prettier | 4 | — | Repo skeleton |
| 0.2 | docker-compose, `bootstrap.sh`, `.env.example` | 4 | 0.1 | `pnpm dev` works |
| 0.3 | CI skeleton (lint, typecheck, unit) | 4 | 0.1 | Green pipeline |
| 0.4 | **Contract v1**: envelope, catalog, cart, checkout, orders, auth, RBAC, admin schemas | 1 | 0.1 | `packages/contracts` |
| 0.5 | Contract review and sign-off | 2, 3, 5 | 0.4 | **Gate G1: contract v1 frozen** |
| 0.6 | Test strategy, factories, MSW handlers generated from the contract | 5 | 0.4 | `packages/test-utils`, `src/mocks` |

### Phase 1 — Core backend and UI shells (Days 3–7)

| # | Task | Agent | Depends on |
|---|---|---|---|
| 1.1 | Prisma schema, init migration with SQL extras, seed | 1 | G1 |
| 1.2 | Auth: register, login, refresh rotation, logout, verify, reset | 1 | 1.1 |
| 1.3 | Catalog, search, facets | 1 | 1.1 |
| 1.4 | Cart, coupons, pricing | 1 | 1.1 |
| 1.5 | Storefront layout, design tokens, home, listing, PDP against MSW | 2 | G1 |
| 1.6 | Admin shell, login + 2FA screens, nav, `Can`, DataTable against MSW | 3 | G1 |
| 1.7 | Unit tests for pricing, RBAC, tokens, written first | 5 | G1 |
| 1.8 | Staging on Render + Vercel preview deploys | 4 | 0.3 |

**Gate G2 (end of Day 7):** the API serves auth, catalog and cart against the seeded DB; storefront listing and PDP switch from MSW to the real API; integration tests for those routes are green.

### Phase 2 — Checkout, orders, admin CRUD (Days 8–13)

| # | Task | Agent | Depends on |
|---|---|---|---|
| 2.1 | Checkout intent, stock reservation, Stripe webhook, reservation-expiry job | 1 | G2 |
| 2.2 | Customer orders, profile, addresses, wishlist, reviews | 1 | G2 |
| 2.3 | Admin endpoints: products, uploads, categories, orders, inventory, coupons, users, audit | 1 | G2 |
| 2.4 | Cart drawer, checkout with Payment Element, account pages | 2 | 2.1 (MSW until ready) |
| 2.5 | Admin products (form, variants, images), orders, inventory, coupons, customers | 3 | 2.3 (MSW until ready) |
| 2.6 | Checkout integration tests incl. concurrency; admin RBAC matrix tests | 5 | 2.1, 2.3 |
| 2.7 | Worker deploy, Stripe webhook on staging, Resend domain, R2 bucket + CORS | 4 | 1.8 |

**Gate G3 (end of Day 13):** a full purchase works end-to-end on staging in Stripe test mode; an admin can create a product with images and ship an order.

### Phase 3 — Analytics, reports, hardening (Days 14–17)

| # | Task | Agent | Depends on |
|---|---|---|---|
| 3.1 | Analytics endpoints and report export jobs | 1 | G3 |
| 3.2 | Overview dashboard, analytics page, reports page | 3 | 3.1 |
| 3.3 | SEO (sitemap, JSON-LD), performance budget, accessibility fixes | 2 | G3 |
| 3.4 | E2E suite (8 critical paths), axe scans, k6 load test, ZAP baseline | 5 | G3 |
| 3.5 | Security review: headers, CSP, rate limits, secrets, dependency audit | 4, 5 | G3 |
| 3.6 | Monitoring, alerts, backup restore drill, runbook | 4 | G3 |

**Gate G4 (Day 17):** all CI gates green, coverage thresholds met, no CRITICAL or HIGH security findings, restore drill passed.

### Phase 4 — Launch (Days 18–20)

| # | Task | Agent | Depends on |
|---|---|---|---|
| 4.1 | Production infra from `render.yaml`, Vercel prod projects, DNS, TLS, live Stripe webhook | 4 | G4 |
| 4.2 | Load the real catalog (CSV import in admin), set stock | 3 + business | 4.1 |
| 4.3 | Live-card test order + refund, smoke script, sign-off | 5 | 4.1 |
| 4.4 | Go live; 48-hour hypercare watching error rate and conversion | all | 4.3 |

### Dependency graph

```
0.1 ─┬─► 0.2
     ├─► 0.3 ─► 1.8 ─► 2.7 ─────────────────────────────────────────┐
     └─► 0.4 ─► G1 ─┬─► 1.1 ─► 1.2 / 1.3 / 1.4 ─► G2 ─┬─► 2.1 ─┬─► 2.4    │
                    ├─► 1.5 (MSW) ─────────────────► G2 ├─► 2.2  │         ├─► G3 ─► 3.x ─► G4 ─► 4.x
                    ├─► 1.6 (MSW) ─────────────────► G2 └─► 2.3 ─┼─► 2.5    │
                    └─► 1.7                                      └─► 2.6 ──┘
```

### Integration rules

1. **Contract first:** no agent invents a field. Changes go through a PR to `packages/contracts` reviewed by every consumer; breaking changes go to `/api/v2` or are made additive.
2. **Mocks from the contract:** frontends build against MSW handlers typed by the contract, so they're never blocked waiting on the API.
3. **Definition of done per task:** code, tests, typed against the contract, reviewed, deployed to a preview.
4. **Daily integration:** every merge to `main` deploys to staging; the E2E suite runs against staging nightly.
5. **One owner per area** (Section 2.1). Changes outside your area need the owner's review.

---

## 10. Agent briefs (paste-ready)

Use these when running the build with AI coding agents. Each assumes this document is at `docs/BLUEPRINT.md` in the repo.

**Agent 1 — Backend**
> You are the backend architect for Hearth & Pan. Read `docs/BLUEPRINT.md` Sections 0–4 and 9. You own `apps/api`, `apps/worker`, `packages/contracts` and `packages/api-client`. Start with task 0.4 (contract v1) and stop for review at Gate G1. Then implement the Phase 1–3 backend tasks in order. Rules: money in integer cents; validate every input with Zod; parameterized SQL only; admin routes behind `authenticate` + `requireAdmin2FA` + `requirePermission`; the Stripe webhook is the only path to `PAID`. Write tests first for pure logic. At each gate, report the endpoints done, test results and any contract change requests.

**Agent 2 — Storefront**
> You are the storefront developer. Read Sections 0–3, 5 and 9. You own `apps/web` and `packages/ui`. Use only types from `@hp/contracts` and the `@hp/api-client`. Build against MSW mocks until the matching endpoint passes integration tests, then switch. Meet the performance and WCAG 2.2 AA requirements in 5.3. Never handle card data outside Stripe Elements. At each gate, report Lighthouse scores and screenshots at 375px and 1280px.

**Agent 3 — Admin**
> You are the admin dashboard developer. Read Sections 0–3, 6 and 9. You own `apps/admin`. Gate every control with `<Can>` using the shared permission matrix, and treat the server as the real security boundary. Implement the checklist in 6.4. Destructive actions need typed confirmation. At each gate, report the screens done and a walkthrough for each role (STAFF, ADMIN, SUPER_ADMIN).

**Agent 4 — DevOps**
> You are the DevOps engineer. Read Sections 0–2, 7 and 9. Deliver the Phase 0 local stack and CI by Day 2 so the others can start. Never commit secrets; `.env.example` holds placeholders only. Production deploys only after CI passes and a manual approval. At each gate, report environment URLs, pipeline status and any manual steps remaining.

**Agent 5 — QA**
> You are the QA lead. Read the whole document, focusing on Section 8. Write tests from the contract before or alongside implementation. You own the 8 critical E2E paths, the coverage gates and the release coverage report. Block a gate if any critical path fails or coverage is below threshold. At each gate, report pass/fail per path, the coverage table and open defects by severity.

---

## 11. Security checklist (release gate)

- [ ] Passwords hashed with Argon2id; login and reset rate-limited; generic error message ("Email or password is incorrect").
- [ ] Access tokens held in memory only; refresh tokens httpOnly, Secure, SameSite, rotated with reuse detection.
- [ ] CSRF: the refresh endpoint requires the SameSite cookie **and** an `Origin` header that matches `CORS_ORIGINS`.
- [ ] Every admin route has `requireAdmin2FA` + `requirePermission`; integration tests assert 401/403 for each.
- [ ] All inputs validated with Zod; all SQL parameterized; product HTML sanitized with DOMPurify on save and render.
- [ ] Stripe webhook signature verified; processing idempotent; amount checked against the order total.
- [ ] Prices and totals always recomputed on the server; client-sent prices ignored.
- [ ] Uploads presigned, type- and size-restricted, with server-generated keys.
- [ ] CSV exports escape formula characters.
- [ ] Security headers: HSTS, CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors.
- [ ] Secrets only in platform secret stores; gitleaks in CI; separate keys per environment.
- [ ] Logs redact authorization headers and cookies.
- [ ] Every admin mutation is in the audit log.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Overselling during a sale | Row locks + reservations + CHECK constraint; concurrency integration test |
| Webhook missed or delayed | Idempotent handler, Stripe retries, `/checkout/complete` polling, nightly reconciliation of PaymentIntents vs orders |
| Contract drift between agents | One contract package, responses parsed in integration tests, owner review |
| Admin account takeover | Mandatory 2FA, Cloudflare Access, short sessions, audit log, alerts on role changes |
| Poor search on typos | `pg_trgm` similarity fallback; upgrade path to Meilisearch behind `SearchService` |
| US sales-tax complexity | Start with the Stripe Tax calculation API inside `taxRateFor`; keep tax in one module |
