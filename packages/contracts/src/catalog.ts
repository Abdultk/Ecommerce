import { z } from "zod";
import {
  Cents,
  HttpUrl,
  Id,
  IsoDateTime,
  Page,
  PageSize,
  PositiveCents,
  QueryBoolean,
  QueryCents,
  Sku,
  Slug,
  queryArray,
} from "./common";

export { Slug } from "./common";

// ---------- Categories ----------

export type Category = { id: string; slug: string; name: string; children: Category[] };

export const Category: z.ZodType<Category> = z.lazy(() =>
  z.object({ id: Id, slug: Slug, name: z.string().min(1).max(80), children: z.array(Category) }),
);

// ---------- Products ----------

export const ProductImage = z.object({
  id: Id,
  url: HttpUrl,
  alt: z.string().max(200),
  position: z.number().int().nonnegative(),
});
export type ProductImage = z.infer<typeof ProductImage>;

/** e.g. { size: "10in", color: "Black" } */
export const VariantAttributes = z.record(z.string().max(40), z.string().max(80));

export const ProductVariant = z.object({
  id: Id,
  sku: Sku,
  name: z.string().min(1).max(80),
  priceCents: PositiveCents,
  compareAtPriceCents: PositiveCents.nullable(),
  /** stockOnHand − stockReserved */
  stockAvailable: Cents,
  attributes: VariantAttributes,
});
export type ProductVariant = z.infer<typeof ProductVariant>;

export const ProductSummary = z.object({
  id: Id,
  slug: Slug,
  name: z.string().min(1).max(160),
  brand: z.string().nullable(),
  categorySlug: Slug,
  fromPriceCents: Cents,
  thumbnailUrl: HttpUrl.nullable(),
  ratingAvg: z.number().min(0).max(5),
  ratingCount: z.number().int().nonnegative(),
  inStock: z.boolean(),
});
export type ProductSummary = z.infer<typeof ProductSummary>;

export const ProductDetail = ProductSummary.extend({
  /** Sanitized HTML */
  description: z.string(),
  material: z.string().nullable(),
  careInstructions: z.string().nullable(),
  dishwasherSafe: z.boolean().nullable(),
  inductionCompatible: z.boolean().nullable(),
  ovenSafeToF: z.number().int().nullable(),
  images: z.array(ProductImage),
  variants: z.array(ProductVariant),
});
export type ProductDetail = z.infer<typeof ProductDetail>;

// ---------- Search ----------

export const SORT_OPTIONS = ["relevance", "price_asc", "price_desc", "newest", "popular"] as const;
export const ProductSort = z.enum(SORT_OPTIONS);
export type ProductSort = z.infer<typeof ProductSort>;

const SearchTerm = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || undefined : value),
  z.string().max(100).optional(),
);

export const ProductQuery = z
  .object({
    q: SearchTerm,
    category: Slug.optional(),
    brand: queryArray(z.string().max(80)),
    material: queryArray(z.string().max(80)),
    minPrice: QueryCents,
    maxPrice: QueryCents,
    inStock: QueryBoolean,
    inductionCompatible: QueryBoolean,
    sort: ProductSort.default("relevance"),
    page: Page,
    pageSize: PageSize,
  })
  .superRefine((q, ctx) => {
    if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
      ctx.addIssue({
        code: "custom",
        path: ["minPrice"],
        message: "Minimum price is above the maximum.",
      });
    }
  });
export type ProductQuery = z.infer<typeof ProductQuery>;

/** `value` is the filter key (the stored text); `label` is its display text in the shopper's language, when different. */
const FacetCount = z.object({
  value: z.string(),
  label: z.string().optional(),
  count: z.number().int().nonnegative(),
});

export const ProductFacets = z.object({
  brands: z.array(FacetCount),
  materials: z.array(FacetCount),
  priceRanges: z.array(
    z.object({
      minCents: Cents,
      maxCents: Cents.nullable(),
      count: z.number().int().nonnegative(),
    }),
  ),
});
export type ProductFacets = z.infer<typeof ProductFacets>;

// ---------- Reviews ----------

export const Review = z.object({
  id: Id,
  rating: z.number().int().min(1).max(5),
  title: z.string(),
  body: z.string(),
  authorName: z.string(),
  verifiedPurchase: z.boolean(),
  createdAt: IsoDateTime,
});
export type Review = z.infer<typeof Review>;

export const ReviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(10, "Write at least 10 characters.").max(4000),
});
export type ReviewInput = z.infer<typeof ReviewInput>;
