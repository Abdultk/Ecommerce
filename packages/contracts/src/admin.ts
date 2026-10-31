import { z } from "zod";
import {
  AggregateCents,
  Cents,
  CouponCode,
  DateInput,
  HttpUrl,
  Id,
  IsoDateTime,
  Page,
  PageSize,
  PositiveCents,
  QueryBoolean,
  Sku,
  Slug,
} from "./common";
import { VariantAttributes } from "./catalog";
import { OrderDetail, OrderNumber, OrderStatus, PaymentProvider } from "./orders";
import { CurrencyCode } from "./money";
import { PaymentMethod } from "./settings";
import { RoleSchema } from "./rbac";

const MAX_OVEN_SAFE_F = 1000;
const MAX_VARIANTS = 50;
const MAX_IMAGES = 12;
const MAX_STOCK_DELTA = 100_000;
const MAX_COUPON_CATEGORIES = 100;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const DATE_ONLY_LENGTH = "YYYY-MM-DD".length;

// ---------- Products ----------

export const ProductStatus = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export type ProductStatus = z.infer<typeof ProductStatus>;

// Stock is never set through product endpoints: every change to on-hand stock
// goes through InventoryAdjustInput so it lands in the StockMovement ledger.
// A new variant may carry `initialStock`, which the API records as a RESTOCK movement.

const compareAtAbovePrice = {
  check: (v: { priceCents?: number; compareAtPriceCents?: number | null }) =>
    v.priceCents === undefined ||
    v.compareAtPriceCents === undefined ||
    v.compareAtPriceCents === null ||
    v.compareAtPriceCents > v.priceCents,
  params: {
    path: ["compareAtPriceCents"],
    message: "Compare-at price must be higher than the price.",
  },
};

const VariantName = z.string().trim().min(1).max(80);
const WeightGrams = z.number().int().positive().max(100_000);

/** A new variant (no id). Strict so stray fields such as stockOnHand are rejected. */
export const AdminVariantInput = z
  .object({
    sku: Sku,
    name: VariantName,
    priceCents: PositiveCents,
    compareAtPriceCents: PositiveCents.nullable().default(null),
    costCents: Cents.nullable().default(null),
    initialStock: z.number().int().nonnegative().max(MAX_STOCK_DELTA).default(0),
    lowStockThreshold: z.number().int().nonnegative().max(MAX_STOCK_DELTA).default(5),
    weightGrams: WeightGrams.nullable().default(null),
    attributes: VariantAttributes.default({}),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine(compareAtAbovePrice.check, compareAtAbovePrice.params);
export type AdminVariantInput = z.infer<typeof AdminVariantInput>;

/** Changes to an existing variant. Only the fields sent are changed; nothing is defaulted. */
export const AdminVariantPatch = z
  .object({
    id: Id,
    sku: Sku.optional(),
    name: VariantName.optional(),
    priceCents: PositiveCents.optional(),
    compareAtPriceCents: PositiveCents.nullable().optional(),
    costCents: Cents.nullable().optional(),
    lowStockThreshold: z.number().int().nonnegative().max(MAX_STOCK_DELTA).optional(),
    weightGrams: WeightGrams.nullable().optional(),
    attributes: VariantAttributes.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(compareAtAbovePrice.check, compareAtAbovePrice.params);
export type AdminVariantPatch = z.infer<typeof AdminVariantPatch>;

/** Must match the key format the presign endpoint issues; the API derives the public URL. */
export const IMAGE_KEY_PATTERN =
  /^products\/\d{4}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpeg|png|webp|avif)$/;

export const AdminImageInput = z
  .object({
    key: z.string().regex(IMAGE_KEY_PATTERN, "Upload the image first, then use the key returned."),
    alt: z.string().trim().max(200),
    position: z.number().int().nonnegative().max(100),
  })
  .strict();

const NullableText = (max: number) => z.string().trim().max(max).nullable().default(null);

const AdminProductFields = z.object({
  name: z.string().trim().min(1).max(160),
  slug: Slug,
  brand: NullableText(80),
  categoryId: Id,
  /** HTML; the API sanitizes it on save. */
  description: z.string().max(20_000),
  material: NullableText(80),
  careInstructions: NullableText(1000),
  dishwasherSafe: z.boolean().nullable().default(null),
  inductionCompatible: z.boolean().nullable().default(null),
  ovenSafeToF: z.number().int().min(100).max(MAX_OVEN_SAFE_F).nullable().default(null),
  status: ProductStatus.default("DRAFT"),
  images: z.array(AdminImageInput).max(MAX_IMAGES).default([]),
  variants: z.array(AdminVariantInput).min(1, "Add at least one variant.").max(MAX_VARIANTS),
});

function rejectDuplicateSkus(
  variants: readonly { sku?: string }[] | undefined,
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  variants?.forEach((v, i) => {
    if (v.sku === undefined) return;
    const key = v.sku.toUpperCase();
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["variants", i, "sku"],
        message: `SKU ${v.sku} is used twice.`,
      });
    }
    seen.add(key);
  });
}

export const AdminProductInput = AdminProductFields.superRefine((p, ctx) =>
  rejectDuplicateSkus(p.variants, ctx),
);
export type AdminProductInput = z.infer<typeof AdminProductInput>;

/**
 * PATCH body. Product fields are optional and never defaulted. Variants listed with an
 * `id` are patched; variants without one are created. Variants not listed are left alone.
 */
export const AdminProductUpdate = z
  .object({
    name: AdminProductFields.shape.name.optional(),
    slug: Slug.optional(),
    brand: z.string().trim().max(80).nullable().optional(),
    categoryId: Id.optional(),
    description: AdminProductFields.shape.description.optional(),
    material: z.string().trim().max(80).nullable().optional(),
    careInstructions: z.string().trim().max(1000).nullable().optional(),
    dishwasherSafe: z.boolean().nullable().optional(),
    inductionCompatible: z.boolean().nullable().optional(),
    ovenSafeToF: z.number().int().min(100).max(MAX_OVEN_SAFE_F).nullable().optional(),
    status: ProductStatus.optional(),
    images: z.array(AdminImageInput).max(MAX_IMAGES).optional(),
    variants: z
      .array(z.union([AdminVariantPatch, AdminVariantInput]))
      .max(MAX_VARIANTS)
      .optional(),
  })
  .strict()
  .superRefine((p, ctx) => rejectDuplicateSkus(p.variants, ctx));
export type AdminProductUpdate = z.infer<typeof AdminProductUpdate>;

/** One row of the admin products table (GET /admin/products). */
export const AdminProductListItem = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  status: ProductStatus,
  categoryName: z.string(),
  thumbnailUrl: HttpUrl.nullable(),
  variantCount: z.number().int().nonnegative(),
  fromPriceCents: Cents,
  /** Sum of stockOnHand − stockReserved across active variants */
  stockAvailable: z.number().int().nonnegative(),
  /** True when any active variant is at or below its low-stock threshold */
  lowStock: z.boolean(),
  updatedAt: IsoDateTime,
});
export type AdminProductListItem = z.infer<typeof AdminProductListItem>;

export const AdminProductQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: ProductStatus.optional(),
  categoryId: Id.optional(),
  lowStock: QueryBoolean,
  sort: z.enum(["name", "price", "stock", "updatedAt"]).default("updatedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: Page,
  pageSize: PageSize,
});

// ---------- Uploads ----------

export const PRESIGN_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const PresignInput = z.object({
  contentType: z.enum(PRESIGN_CONTENT_TYPES),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(MAX_IMAGE_BYTES, "Images must be 8 MB or smaller."),
});
export type PresignInput = z.infer<typeof PresignInput>;

export const PresignResult = z.object({
  uploadUrl: HttpUrl,
  key: z.string().regex(IMAGE_KEY_PATTERN),
  publicUrl: HttpUrl,
});
export type PresignResult = z.infer<typeof PresignResult>;

// ---------- Orders ----------

/** Statuses an admin may set directly. Cancel and refund have dedicated endpoints. */
export const ADMIN_SETTABLE_STATUSES = ["PROCESSING", "SHIPPED", "DELIVERED"] as const;

export const OrderStatusUpdate = z
  .object({
    status: z.enum(ADMIN_SETTABLE_STATUSES),
    trackingNumber: z.string().trim().min(1).max(64).optional(),
    /** Courier name shown to the customer, e.g. "Aramex". Free text: the shop picks its couriers. */
    carrier: z.string().trim().min(1).max(60).optional(),
    /** Date staff expect it to arrive (YYYY-MM-DD, store time). Only they know; never computed. */
    expectedDeliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-28.")
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((u) => u.status !== "SHIPPED" || u.trackingNumber !== undefined, {
    path: ["trackingNumber"],
    message: "Add a tracking number to mark the order as shipped.",
  });
export type OrderStatusUpdate = z.infer<typeof OrderStatusUpdate>;

export const CancelOrderInput = z.object({ reason: z.string().trim().max(500).optional() });

const BankReference = z.string().trim().min(1, "Enter the bank reference.").max(64);

export const RefundInput = z.object({
  amountCents: PositiveCents,
  reason: z.string().trim().max(500).optional(),
  /** Reference of the manual bank refund. The API requires it for bank-transfer orders. */
  bankReference: BankReference.optional(),
});
export type RefundInput = z.infer<typeof RefundInput>;

/**
 * POST /admin/orders/:id/confirm-transfer (Idempotency-Key required). `receivedCents`
 * must equal the order total, else 422 AMOUNT_MISMATCH.
 */
export const ConfirmTransferInput = z.object({
  receivedCents: PositiveCents,
  bankReference: BankReference,
  note: z.string().trim().max(500).optional(),
});
export type ConfirmTransferInput = z.infer<typeof ConfirmTransferInput>;

export const AdminOrderQuery = z
  .object({
    status: OrderStatus.optional(),
    paymentMethod: PaymentMethod.optional(),
    q: z.string().trim().max(100).optional(),
    from: DateInput.optional(),
    to: DateInput.optional(),
    page: Page,
    pageSize: PageSize,
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    path: ["to"],
    message: "End date is before the start date.",
  });

// ---------- Inventory ----------

/** SALE movements are written only by checkout; admins cannot create them. */
export const StockAdjustReason = z.enum(["RESTOCK", "RETURN", "DAMAGE", "CORRECTION"]);

export const InventoryAdjustInput = z.object({
  variantId: Id,
  delta: z
    .number()
    .int()
    .min(-MAX_STOCK_DELTA)
    .max(MAX_STOCK_DELTA)
    .refine((d) => d !== 0, "Enter a non-zero change."),
  reason: StockAdjustReason,
  note: z.string().trim().max(500).optional(),
});
export type InventoryAdjustInput = z.infer<typeof InventoryAdjustInput>;

// ---------- Coupons ----------

export const CouponType = z.enum(["PERCENT", "FIXED", "FREE_SHIPPING"]);

export const CouponInput = z
  .object({
    code: CouponCode,
    type: CouponType,
    /** Percent (1–100) for PERCENT, cents for FIXED, 0 for FREE_SHIPPING */
    value: z.number().int().nonnegative(),
    minSubtotalCents: Cents.default(0),
    maxRedemptions: z.number().int().positive().nullable().default(null),
    perCustomerLimit: z.number().int().positive().nullable().default(1),
    startsAt: DateInput.optional(),
    endsAt: DateInput.optional(),
    isActive: z.boolean().default(true),
    categoryIds: z.array(Id).max(MAX_COUPON_CATEGORIES).default([]),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (c.type === "PERCENT" && (c.value < 1 || c.value > 100))
      issue("value", "Enter a percentage from 1 to 100.");
    if (c.type === "FIXED" && c.value < 1) issue("value", "Enter an amount greater than zero.");
    if (c.type === "FREE_SHIPPING" && c.value !== 0)
      issue("value", "Free-shipping coupons have no value.");
    if (c.startsAt && c.endsAt && c.endsAt <= c.startsAt)
      issue("endsAt", "End date must be after the start date.");
  });
export type CouponInput = z.infer<typeof CouponInput>;

// ---------- Users ----------

/**
 * Role changes need `user:write` (SUPER_ADMIN only). The API must also refuse
 * self-demotion and demoting the last SUPER_ADMIN; the schema cannot see that state.
 */
export const AdminUserUpdate = z
  .object({ disabled: z.boolean().optional(), role: RoleSchema.optional() })
  .strict()
  .refine((u) => u.disabled !== undefined || u.role !== undefined, "Change at least one field.");
export type AdminUserUpdate = z.infer<typeof AdminUserUpdate>;

// ---------- Analytics & reports ----------

export const AnalyticsInterval = z.enum(["day", "week", "month"]);

/** A DateInput that also remembers whether the client sent a date only ("YYYY-MM-DD"). */
const DateBound = z.string().transform((raw, ctx) => {
  const parsed = DateInput.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, fatal: true });
    }
    return z.NEVER;
  }
  return { at: parsed.data, dateOnly: raw.length === DATE_ONLY_LENGTH };
});

const AnalyticsRangeFields = z.object({
  from: DateInput,
  to: DateBound,
  interval: AnalyticsInterval.default("day"),
});

function checkRange(r: { from: Date; to: { at: Date } }, ctx: z.RefinementCtx) {
  if (r.to.at < r.from) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "End date is before the start date." });
  } else if ((r.to.at.getTime() - r.from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: `Choose a range of ${MAX_RANGE_DAYS} days or less.`,
    });
  }
}

/** Flattens `to` back to a Date and exposes whether it was date-only. */
const flattenTo = <T extends { to: { at: Date; dateOnly: boolean } }>({ to, ...rest }: T) => ({
  ...rest,
  to: to.at,
  /** True when `to` was "YYYY-MM-DD": the range then runs through the end of that UTC day. */
  toDateOnly: to.dateOnly,
});

/**
 * Query for every analytics endpoint. A date-only `to` means "through the end of that
 * day" (UTC); a timestamp `to` (even exactly midnight) is an exclusive end. Buckets are
 * UTC. The previous period has the same length and ends at `from`.
 */
export const AnalyticsRange = AnalyticsRangeFields.superRefine(checkRange).transform(flattenTo);
export type AnalyticsRange = z.infer<typeof AnalyticsRange>;

export const MAX_TOP_PRODUCTS = 50;

/** GET /admin/analytics/top-products */
export const TopProductsQuery = AnalyticsRangeFields.extend({
  by: z.enum(["revenue", "units"]).default("revenue"),
  limit: z.coerce.number().int().min(1).max(MAX_TOP_PRODUCTS).default(10),
})
  .superRefine(checkRange)
  .transform(flattenTo);
export type TopProductsQuery = z.infer<typeof TopProductsQuery>;

const Kpis = z.object({
  revenueCents: AggregateCents,
  orders: z.number().int().nonnegative(),
  aovCents: AggregateCents,
  refundRate: z.number().min(0).max(1),
  newCustomers: z.number().int().nonnegative(),
  returningCustomers: z.number().int().nonnegative(),
  grossMarginCents: z.number().int().nullable(),
  lowStockSkus: z.number().int().nonnegative(),
});

/** Amounts are in the store currency's minor units. */
export const AnalyticsSummary = z.object({
  current: Kpis,
  previous: Kpis,
  currency: CurrencyCode,
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummary>;

export const SalesPoint = z.object({
  bucket: IsoDateTime,
  orders: z.number().int().nonnegative(),
  revenueCents: AggregateCents,
  aovCents: AggregateCents,
});
export type SalesPoint = z.infer<typeof SalesPoint>;

export const TopProduct = z.object({
  productId: Id,
  name: z.string(),
  unitsSold: z.number().int().nonnegative(),
  revenueCents: AggregateCents,
});
export type TopProduct = z.infer<typeof TopProduct>;

/** GET /admin/analytics/sales-by-category: item revenue per product category. */
export const CategorySales = z.object({
  categoryId: Id,
  name: z.string(),
  /** Distinct orders containing at least one item from the category */
  orders: z.number().int().nonnegative(),
  unitsSold: z.number().int().nonnegative(),
  revenueCents: AggregateCents,
});
export type CategorySales = z.infer<typeof CategorySales>;

export const ReportType = z.enum(["orders", "sales-by-day", "inventory", "customers"]);
export type ReportType = z.infer<typeof ReportType>;
export const ReportFormat = z.enum(["csv", "xlsx"]);
export type ReportFormat = z.infer<typeof ReportFormat>;
/** "expired": the file was deleted after the retention period; no download link. */
export const ReportStatus = z.enum(["queued", "running", "done", "failed", "expired"]);
export type ReportStatus = z.infer<typeof ReportStatus>;

/** POST /admin/reports. `range` is ignored for the inventory snapshot. */
export const ReportRequest = z.object({
  type: ReportType,
  format: ReportFormat,
  range: AnalyticsRange,
});
export type ReportRequest = z.infer<typeof ReportRequest>;

export const ReportJob = z.object({
  id: Id,
  type: ReportType,
  format: ReportFormat,
  status: ReportStatus,
  /** The resolved period: `to` is exclusive (a date-only end becomes the next midnight). */
  range: z.object({ from: IsoDateTime, to: IsoDateTime }),
  rowCount: z.number().int().nonnegative().nullable(),
  /** User-safe reason when status is "failed" */
  error: z.string().nullable(),
  /** Short-lived signed link, present only when the job is done; fetch the job again for a fresh one. */
  downloadUrl: HttpUrl.nullable(),
  downloadExpiresAt: IsoDateTime.nullable(),
  requestedByEmail: z.string().nullable(),
  createdAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
});
export type ReportJob = z.infer<typeof ReportJob>;

/** GET /admin/reports: the caller's jobs, newest first (SUPER_ADMIN sees everyone's). */
export const ReportJobQuery = z.object({ page: Page, pageSize: PageSize });

// ---------- Phase 2: admin read models ----------

/** A variant as the admin edit form sees it (includes stock and cost). */
export const AdminVariant = z.object({
  id: Id,
  sku: Sku,
  name: z.string(),
  priceCents: PositiveCents,
  compareAtPriceCents: PositiveCents.nullable(),
  costCents: Cents.nullable(),
  stockOnHand: z.number().int().nonnegative(),
  stockReserved: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive().nullable(),
  attributes: VariantAttributes,
  isActive: z.boolean(),
});
export type AdminVariant = z.infer<typeof AdminVariant>;

/** GET /admin/products/:id — everything the edit form needs. */
export const AdminProductDetail = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  brand: z.string().nullable(),
  categoryId: Id,
  description: z.string(),
  material: z.string().nullable(),
  careInstructions: z.string().nullable(),
  dishwasherSafe: z.boolean().nullable(),
  inductionCompatible: z.boolean().nullable(),
  ovenSafeToF: z.number().int().nullable(),
  status: ProductStatus,
  images: z.array(
    z.object({
      id: Id,
      key: z.string(),
      url: HttpUrl,
      alt: z.string(),
      position: z.number().int(),
    }),
  ),
  variants: z.array(AdminVariant),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AdminProductDetail = z.infer<typeof AdminProductDetail>;

export const AdminCategoryInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: Slug,
  parentId: Id.nullable().default(null),
  position: z.number().int().min(0).max(1000).default(0),
});
export type AdminCategoryInput = z.infer<typeof AdminCategoryInput>;

export const AdminOrderListItem = z.object({
  id: Id,
  number: OrderNumber,
  status: OrderStatus,
  email: z.string().email(),
  customerName: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  totalCents: Cents,
  refundedCents: Cents,
  createdAt: IsoDateTime,
  paidAt: IsoDateTime.nullable(),
  currency: CurrencyCode,
  paymentMethod: PaymentMethod,
  /** The admin-defined method's name for "manual" orders; null otherwise. */
  paymentLabel: z.string().nullable(),
  /** Set while a bank transfer or manual payment is awaited (the "Awaiting transfer" badge). */
  paymentDueAt: IsoDateTime.nullable(),
});
export type AdminOrderListItem = z.infer<typeof AdminOrderListItem>;

/** GET /admin/orders/:id — the customer-facing order plus admin-only context. */
export const AdminOrderDetail = z.object({
  order: OrderDetail,
  customer: z.object({ id: Id, email: z.string().email(), name: z.string() }).nullable(),
  /** The provider's payment id (Stripe PaymentIntent, Amwal transaction); null for transfers. */
  paymentIntentId: z.string().nullable(),
  paymentProvider: PaymentProvider.nullable(),
  /** Bank reference an admin recorded when confirming a transfer. */
  transferBankReference: z.string().nullable(),
  transferConfirmedByEmail: z.string().nullable(),
  refunds: z.array(
    z.object({
      id: Id,
      amountCents: PositiveCents,
      reason: z.string().nullable(),
      actorEmail: z.string().nullable(),
      createdAt: IsoDateTime,
      provider: PaymentProvider,
      bankReference: z.string().nullable(),
    }),
  ),
  /** Statuses the admin may move this order to via PATCH /status (server-computed). */
  allowedStatuses: z.array(z.enum(ADMIN_SETTABLE_STATUSES)),
  canCancel: z.boolean(),
  /** Remaining amount that can still be refunded. */
  refundableCents: Cents,
});
export type AdminOrderDetail = z.infer<typeof AdminOrderDetail>;

export const InventoryItem = z.object({
  variantId: Id,
  productId: Id,
  productName: z.string(),
  variantName: z.string(),
  sku: Sku,
  stockOnHand: z.number().int().nonnegative(),
  stockReserved: z.number().int().nonnegative(),
  stockAvailable: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative(),
  lowStock: z.boolean(),
  isActive: z.boolean(),
});
export type InventoryItem = z.infer<typeof InventoryItem>;

export const AdminInventoryQuery = z.object({
  q: z.string().trim().max(100).optional(),
  lowStock: QueryBoolean,
  page: Page,
  pageSize: PageSize,
});

export const StockMovementView = z.object({
  id: Id,
  delta: z.number().int(),
  reason: z.enum(["RESTOCK", "SALE", "RETURN", "DAMAGE", "CORRECTION"]),
  note: z.string().nullable(),
  orderNumber: z.string().nullable(),
  actorEmail: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type StockMovementView = z.infer<typeof StockMovementView>;

export const CouponView = z.object({
  id: Id,
  code: z.string(),
  type: CouponType,
  value: z.number().int().nonnegative(),
  minSubtotalCents: Cents,
  maxRedemptions: z.number().int().positive().nullable(),
  perCustomerLimit: z.number().int().positive().nullable(),
  redemptions: z.number().int().nonnegative(),
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
  isActive: z.boolean(),
  categoryIds: z.array(Id),
  createdAt: IsoDateTime,
});
export type CouponView = z.infer<typeof CouponView>;

export const AdminUserListItem = z.object({
  id: Id,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: RoleSchema,
  disabled: z.boolean(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  orderCount: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
  lastLoginAt: IsoDateTime.nullable(),
});
export type AdminUserListItem = z.infer<typeof AdminUserListItem>;

export const AdminUserQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: RoleSchema.optional(),
  page: Page,
  pageSize: PageSize,
});

export const AuditLogEntry = z.object({
  id: Id,
  actorId: Id,
  actorEmail: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

export const AuditLogQuery = z.object({
  entity: z.string().trim().max(40).optional(),
  actorId: Id.optional(),
  page: Page,
  pageSize: PageSize,
});
