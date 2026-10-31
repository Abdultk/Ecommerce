import { z } from "zod";

/** Database identifiers (cuid). Opaque to clients. */
export const Id = z.string().min(1).max(64);

/**
 * Cap for any single amount, in minor units (99,999.999 OMR or 999,999.99 USD). Keeps
 * values well inside Postgres int4 and above any realistic single order.
 */
export const MAX_CENTS = 99_999_999;

/**
 * Money is always integer minor units of the currency (baisa for OMR, cents for USD;
 * see money.ts). Never floats. The "Cents" name is historical. Capped for any single amount.
 */
export const Cents = z.number().int().nonnegative().max(MAX_CENTS);
export const PositiveCents = z.number().int().positive().max(MAX_CENTS);
/** Sums across many orders (revenue, analytics) — not capped at a single charge. */
export const AggregateCents = z.number().int().nonnegative();

/** ISO-8601 timestamp with offset, e.g. 2026-10-10T14:00:00Z */
export const IsoDateTime = z.string().datetime({ offset: true });

/** Server-produced links. Rejects javascript:, data: and other schemes. */
export const HttpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL.");

const ISO_DATE_INPUT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Date input from clients: "YYYY-MM-DD" (UTC midnight) or a full ISO timestamp with offset.
 * Rejects numbers, arrays, loose strings and impossible dates such as 2026-02-30.
 */
export const DateInput = z
  .string()
  .regex(ISO_DATE_INPUT, "Use YYYY-MM-DD or an ISO timestamp.")
  .transform((s, ctx) => {
    const date = new Date(s);
    const invalid = Number.isNaN(date.getTime());
    // JS rolls 2026-02-30 over to March 2; catch that for date-only input.
    const rolledOver = !invalid && s.length === 10 && date.toISOString().slice(0, 10) !== s;
    if (invalid || rolledOver) {
      // fatal: stop here so parent refinements (e.g. from <= to) never see a missing date
      ctx.addIssue({ code: "custom", message: "That date does not exist.", fatal: true });
      return z.NEVER;
    }
    return date;
  });

export const Email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export const Slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");

export const Sku = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "Use letters, numbers and hyphens.");

export const CouponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/, "Use 3–32 letters, numbers or hyphens.");

export const PersonName = z.string().trim().min(1, "Required.").max(60);

/**
 * Order and cart totals. The invariant mirrors the DB CHECK constraint:
 * total = subtotal − discount + shipping + tax.
 */
export const Totals = z
  .object({
    subtotalCents: Cents,
    discountCents: Cents,
    shippingCents: Cents,
    taxCents: Cents,
    totalCents: Cents,
  })
  .superRefine((t, ctx) => {
    if (t.discountCents > t.subtotalCents) {
      ctx.addIssue({
        code: "custom",
        path: ["discountCents"],
        message: "Discount exceeds subtotal.",
      });
    }
    if (t.totalCents !== t.subtotalCents - t.discountCents + t.shippingCents + t.taxCents) {
      ctx.addIssue({ code: "custom", path: ["totalCents"], message: "Totals do not add up." });
    }
  });
export type Totals = z.infer<typeof Totals>;

// ---------- Query-string helpers ----------
// Query strings arrive as strings (or repeated keys as arrays); these normalize them.

const TRUE_STRINGS = new Set(["true", "1"]);
const FALSE_STRINGS = new Set(["false", "0"]);

/** Parses "true"/"1"/"false"/"0"; anything else is a validation error. */
export const QueryBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (TRUE_STRINGS.has(value)) return true;
  if (FALSE_STRINGS.has(value)) return false;
  return value;
}, z.boolean().optional());

/** Accepts `?brand=a` or `?brand=a&brand=b` and always yields an array. */
export const queryArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    z.array(item).max(20).optional(),
  );

/** Optional money filter from a query string; blank values mean "not set". */
export const QueryCents = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().nonnegative().max(MAX_CENTS).optional(),
);

export const MAX_PAGE = 10_000;
export const Page = z.coerce.number().int().min(1).max(MAX_PAGE).default(1);
export const PageSize = z.coerce.number().int().min(1).max(100).default(24);
