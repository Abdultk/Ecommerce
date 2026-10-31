import type { Category, ProductDetail } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { currentLang, localized } from "../../lib/locale";
import type { DbClient } from "../../lib/prisma";

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  translations?: unknown;
  parentId: string | null;
};

/** Builds the nested tree from flat rows (already ordered by position). */
export function buildCategoryTree(rows: readonly CategoryRow[]): Category[] {
  const childrenOf = (parentId: string | null): Category[] =>
    rows
      .filter((r) => r.parentId === parentId)
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        name: localized(r.translations, "name", r.name),
        children: childrenOf(r.id),
      }));
  return childrenOf(null);
}

/**
 * Keeps a category when it, or anything below it, holds a product shoppers can see, so the
 * storefront never lists a collection with nothing in it.
 */
export function withLiveProducts<T extends { id: string; parentId: string | null }>(
  rows: readonly T[],
  liveCategoryIds: ReadonlySet<string>,
): T[] {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId] as const));
  const keep = new Set<string>();
  for (const id of liveCategoryIds) {
    for (let at: string | null | undefined = id; at && !keep.has(at); at = parentOf.get(at)) {
      keep.add(at);
    }
  }
  return rows.filter((r) => keep.has(r.id));
}

export async function getCategoryTree(db: DbClient): Promise<Category[]> {
  const rows = await db.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, slug: true, name: true, translations: true, parentId: true },
  });
  const live = await db.product.findMany({
    where: { status: "ACTIVE", variants: { some: { isActive: true } } },
    select: { categoryId: true },
    distinct: ["categoryId"],
  });
  return buildCategoryTree(withLiveProducts(rows, new Set(live.map((p) => p.categoryId))));
}

const asStringRecord = (value: unknown): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"),
      )
    : {};

/** Only ACTIVE products with at least one active variant are visible to shoppers. */
export async function getProductBySlug(db: DbClient, slug: string): Promise<ProductDetail> {
  const product = await db.product.findFirst({
    where: { slug, status: "ACTIVE" },
    include: {
      category: { select: { slug: true } },
      images: { orderBy: { position: "asc" } },
      variants: { where: { isActive: true }, orderBy: [{ priceCents: "asc" }, { sku: "asc" }] },
    },
  });
  if (!product || product.variants.length === 0)
    throw new AppError("NOT_FOUND", "Product not found.");

  const variants = product.variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    name: localized(v.translations, "name", v.name),
    priceCents: v.priceCents,
    compareAtPriceCents: v.compareAtPriceCents,
    stockAvailable: Math.max(0, v.stockOnHand - v.stockReserved),
    attributes: asStringRecord(v.attributes),
  }));

  const productName = localized(product.translations, "name", product.name);
  return {
    id: product.id,
    slug: product.slug,
    name: productName,
    brand: product.brand,
    categorySlug: product.category.slug,
    fromPriceCents: Math.min(...variants.map((v) => v.priceCents)),
    thumbnailUrl: product.images[0]?.url ?? null,
    ratingAvg: Number(product.ratingAvg),
    ratingCount: product.ratingCount,
    inStock: variants.some((v) => v.stockAvailable > 0),
    description: localized(product.translations, "description", product.description),
    material: localized(product.translations, "material", product.material),
    careInstructions: localized(product.translations, "careInstructions", product.careInstructions),
    dishwasherSafe: product.dishwasherSafe,
    inductionCompatible: product.inductionCompatible,
    ovenSafeToF: product.ovenSafeToF,
    images: product.images.map((i) => ({
      id: i.id,
      url: i.url,
      alt: currentLang() === "ar" ? productName : i.alt,
      position: i.position,
    })),
    variants,
  };
}
