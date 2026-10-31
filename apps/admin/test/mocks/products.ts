import {
  AdminProductDetail,
  AdminProductListItem,
  type Category,
  type ProductStatus,
} from "@hp/contracts";
import { makeCategoryTree, sampleCatalog } from "@hp/test-utils";
import { FIXTURE_CDN_URL } from "@/lib/config";
import { toStoreMinor } from "./settings";
import type { MockCategory } from "./types";

// Admin products derived from the shared sample catalog, so the admin and
// storefront mocks describe the same eight products.

export const MOCK_LOW_STOCK_THRESHOLD = 5;

// The catalog only has published products; give a couple an admin-only status.
const STATUS_BY_INDEX: Readonly<Record<number, ProductStatus>> = { 2: "DRAFT", 5: "ARCHIVED" };

/** A key in the presign format: products/<year>/<uuid>.<ext>. Deterministic for seeds. */
export const seedImageKey = (n: number): string =>
  `products/2026/00000000-0000-4000-8000-${String(n).padStart(12, "0")}.webp`;

export const imageUrlForKey = (key: string): string => `${FIXTURE_CDN_URL}/${key}`;

export function seedCategories(): MockCategory[] {
  const flat: MockCategory[] = [];
  const walk = (nodes: readonly Category[], parentId: string | null) =>
    nodes.forEach((c, position) => {
      flat.push({ id: c.id, slug: c.slug, name: c.name, parentId, position });
      walk(c.children, c.id);
    });
  walk(makeCategoryTree(), null);
  return flat;
}

export function seedProducts(): AdminProductDetail[] {
  return sampleCatalog().map((p, i) => {
    const key = seedImageKey(i + 1);
    return AdminProductDetail.parse({
      id: p.id,
      slug: p.slug,
      name: p.name,
      brand: p.brand,
      categoryId: `cat_${p.categorySlug}`,
      description: p.description,
      material: p.material,
      careInstructions: p.careInstructions,
      dishwasherSafe: p.dishwasherSafe,
      inductionCompatible: p.inductionCompatible,
      ovenSafeToF: p.ovenSafeToF,
      status: STATUS_BY_INDEX[i] ?? "ACTIVE",
      images: [
        { id: `img_seed_${i + 1}`, key, url: imageUrlForKey(key), alt: p.name, position: 0 },
      ],
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        priceCents: toStoreMinor(v.priceCents),
        compareAtPriceCents:
          v.compareAtPriceCents === null ? null : toStoreMinor(v.compareAtPriceCents),
        costCents: toStoreMinor(Math.round(v.priceCents * 0.45)),
        stockOnHand: v.stockAvailable,
        stockReserved: 0,
        lowStockThreshold: MOCK_LOW_STOCK_THRESHOLD,
        weightGrams: null,
        attributes: v.attributes,
        isActive: true,
      })),
      createdAt: new Date(Date.UTC(2026, 0, 10 + i, 9)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 9, 1 - i, 12)).toISOString(),
    });
  });
}

export function toProductListItem(
  p: AdminProductDetail,
  categories: readonly MockCategory[],
): AdminProductListItem {
  const active = p.variants.filter((v) => v.isActive);
  const priced = active.length > 0 ? active : p.variants;
  const sortedImages = [...p.images].sort((a, b) => a.position - b.position);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    categoryName: categories.find((c) => c.id === p.categoryId)?.name ?? "Uncategorized",
    thumbnailUrl: sortedImages[0]?.url ?? null,
    variantCount: p.variants.length,
    fromPriceCents: priced.length > 0 ? Math.min(...priced.map((v) => v.priceCents)) : 0,
    stockAvailable: active.reduce((sum, v) => sum + (v.stockOnHand - v.stockReserved), 0),
    lowStock: active.some((v) => v.stockOnHand - v.stockReserved <= v.lowStockThreshold),
    updatedAt: p.updatedAt,
  };
}

/** Table rows for the seeded catalog (tests compare against these). */
export function buildAdminProductRows(): AdminProductListItem[] {
  const categories = seedCategories();
  return seedProducts().map((p) => AdminProductListItem.parse(toProductListItem(p, categories)));
}
