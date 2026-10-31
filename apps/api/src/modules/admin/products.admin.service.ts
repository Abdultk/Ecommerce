import { Prisma } from "@prisma/client";
import type { Product, ProductImage, ProductVariant } from "@prisma/client";
import {
  VariantAttributes,
  type AdminProductDetail,
  type AdminProductInput,
  type AdminProductListItem,
  type AdminProductUpdate,
  type AdminVariantInput,
  type AdminVariantPatch,
} from "@hp/contracts";
import { AppError } from "../../lib/errors";
import type { DbClient } from "../../lib/prisma";
import { sanitizeProductHtml } from "../../lib/sanitize";
import type { ImageStorage } from "../../lib/storage";

type ListQuery = {
  q?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  categoryId?: string;
  lowStock?: boolean;
  sort: "name" | "price" | "stock" | "updatedAt";
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
};

/** Whitelisted ORDER BY columns: user input never reaches the SQL text. */
const SORT_SQL: Record<ListQuery["sort"], string> = {
  name: `"name"`,
  price: `"fromPriceCents"`,
  stock: `"stockAvailable"`,
  updatedAt: `"updatedAt"`,
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type ListRow = Omit<AdminProductListItem, "updatedAt"> & { updatedAt: Date; total: bigint };

/** One SQL query so sorting by price or stock works across the whole table, not one page. */
export async function listAdminProducts(
  db: DbClient,
  query: ListQuery,
): Promise<{ items: AdminProductListItem[]; total: number }> {
  const filters: Prisma.Sql[] = [];
  if (query.status) filters.push(Prisma.sql`p."status" = ${query.status}::"ProductStatus"`);
  if (query.categoryId) filters.push(Prisma.sql`p."categoryId" = ${query.categoryId}`);
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    filters.push(Prisma.sql`(p."name" ILIKE ${pattern} OR p."slug" ILIKE ${pattern}
      OR EXISTS (SELECT 1 FROM "ProductVariant" sv WHERE sv."productId" = p.id AND sv."sku" ILIKE ${pattern}))`);
  }
  const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
  const lowStockOnly = query.lowStock ? Prisma.sql`WHERE "lowStock"` : Prisma.empty;
  const order = Prisma.raw(
    `${SORT_SQL[query.sort]} ${query.dir === "asc" ? "ASC" : "DESC"}, "id" ASC`,
  );

  const rows = await db.$queryRaw<ListRow[]>`
    WITH listed AS (
      SELECT p.id, p."slug", p."name", p."status"::text AS "status", c."name" AS "categoryName",
        p."updatedAt",
        (SELECT i."url" FROM "ProductImage" i WHERE i."productId" = p.id
          ORDER BY i."position" LIMIT 1) AS "thumbnailUrl",
        COUNT(v.id)::int AS "variantCount",
        COALESCE(MIN(v."priceCents") FILTER (WHERE v."isActive"), MIN(v."priceCents"), 0)::int
          AS "fromPriceCents",
        COALESCE(SUM(GREATEST(v."stockOnHand" - v."stockReserved", 0))
          FILTER (WHERE v."isActive"), 0)::int AS "stockAvailable",
        COALESCE(BOOL_OR(v."isActive"
          AND v."stockOnHand" - v."stockReserved" <= v."lowStockThreshold"), false) AS "lowStock"
      FROM "Product" p
      JOIN "Category" c ON c.id = p."categoryId"
      LEFT JOIN "ProductVariant" v ON v."productId" = p.id
      ${where}
      GROUP BY p.id, c."name"
    )
    SELECT listed.*, COUNT(*) OVER () AS total FROM listed
    ${lowStockOnly}
    ORDER BY ${order}
    LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;

  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map(({ total: _total, updatedAt, ...row }) => ({
      ...row,
      updatedAt: new Date(updatedAt).toISOString(),
    })),
  };
}

// ---------- Detail ----------

export type ProductWithParts = Product & { variants: ProductVariant[]; images: ProductImage[] };

export const toAdminProductDetail = (p: ProductWithParts): AdminProductDetail => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  brand: p.brand,
  categoryId: p.categoryId,
  description: p.description,
  material: p.material,
  careInstructions: p.careInstructions,
  dishwasherSafe: p.dishwasherSafe,
  inductionCompatible: p.inductionCompatible,
  ovenSafeToF: p.ovenSafeToF,
  status: p.status,
  images: [...p.images]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({ id: i.id, key: i.key, url: i.url, alt: i.alt, position: i.position })),
  variants: [...p.variants]
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      priceCents: v.priceCents,
      compareAtPriceCents: v.compareAtPriceCents,
      costCents: v.costCents,
      stockOnHand: v.stockOnHand,
      stockReserved: v.stockReserved,
      lowStockThreshold: v.lowStockThreshold,
      weightGrams: v.weightGrams,
      attributes: VariantAttributes.catch({}).parse(v.attributes),
      isActive: v.isActive,
    })),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export async function loadAdminProduct(db: DbClient, id: string): Promise<ProductWithParts> {
  const product = await db.product.findUnique({
    where: { id },
    include: { variants: true, images: true },
  });
  if (!product) throw new AppError("NOT_FOUND", "Product not found.");
  return product;
}

/** What the audit log keeps for a product change. */
export const auditSnapshot = (p: ProductWithParts) => ({
  name: p.name,
  slug: p.slug,
  status: p.status,
  categoryId: p.categoryId,
  variants: p.variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    priceCents: v.priceCents,
    isActive: v.isActive,
  })),
  imageCount: p.images.length,
});

// ---------- Writes ----------

async function assertCategory(db: DbClient, categoryId: string) {
  if (!(await db.category.findUnique({ where: { id: categoryId } }))) {
    throw new AppError("VALIDATION_ERROR", "Choose an existing category.", {
      categoryId: ["Unknown category."],
    });
  }
}

/** Friendly conflict messages instead of a bare unique-constraint error. */
async function assertUnique(
  db: DbClient,
  productId: string | null,
  slug: string | undefined,
  skus: string[],
) {
  if (slug) {
    const clash = await db.product.findFirst({
      where: { slug, ...(productId && { id: { not: productId } }) },
    });
    if (clash) throw new AppError("CONFLICT", `Another product already uses the slug "${slug}".`);
  }
  if (skus.length) {
    const clash = await db.productVariant.findFirst({
      where: {
        OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })),
        ...(productId && { productId: { not: productId } }),
      },
    });
    if (clash) throw new AppError("CONFLICT", `SKU ${clash.sku} is already in use.`);
  }
}

const imageRows = (storage: ImageStorage, images: AdminProductInput["images"]) =>
  images.map((i) => ({
    key: i.key,
    url: storage.publicUrl(i.key),
    alt: i.alt,
    position: i.position,
  }));

const variantData = (v: AdminVariantInput) => ({
  sku: v.sku,
  name: v.name,
  priceCents: v.priceCents,
  compareAtPriceCents: v.compareAtPriceCents,
  costCents: v.costCents,
  stockOnHand: v.initialStock,
  lowStockThreshold: v.lowStockThreshold,
  weightGrams: v.weightGrams,
  attributes: v.attributes,
  isActive: v.isActive,
});

/** New variants may start with stock; it enters the ledger as a RESTOCK movement. */
async function createVariant(
  tx: DbClient,
  productId: string,
  v: AdminVariantInput,
  actorId: string,
) {
  const variant = await tx.productVariant.create({ data: { ...variantData(v), productId } });
  if (v.initialStock > 0) {
    await tx.stockMovement.create({
      data: {
        variantId: variant.id,
        delta: v.initialStock,
        reason: "RESTOCK",
        note: "Initial stock",
        actorId,
      },
    });
  }
}

export async function createAdminProduct(
  tx: DbClient,
  storage: ImageStorage,
  input: AdminProductInput,
  actorId: string,
): Promise<ProductWithParts> {
  await assertCategory(tx, input.categoryId);
  await assertUnique(
    tx,
    null,
    input.slug,
    input.variants.map((v) => v.sku),
  );
  const { variants, images, ...fields } = input;
  const product = await tx.product.create({
    data: {
      ...fields,
      description: sanitizeProductHtml(fields.description),
      images: { create: imageRows(storage, images) },
    },
  });
  for (const v of variants) await createVariant(tx, product.id, v, actorId);
  return loadAdminProduct(tx, product.id);
}

const isVariantPatch = (v: AdminVariantPatch | AdminVariantInput): v is AdminVariantPatch =>
  "id" in v;

export async function updateAdminProduct(
  tx: DbClient,
  storage: ImageStorage,
  id: string,
  input: AdminProductUpdate,
  actorId: string,
): Promise<ProductWithParts> {
  const existing = await loadAdminProduct(tx, id);
  const { variants, images, ...fields } = input;
  if (fields.categoryId) await assertCategory(tx, fields.categoryId);
  await assertUnique(
    tx,
    id,
    fields.slug,
    (variants ?? []).flatMap((v) => (v.sku ? [v.sku] : [])),
  );

  await tx.product.update({
    where: { id },
    data: {
      ...fields,
      ...(fields.description !== undefined && {
        description: sanitizeProductHtml(fields.description),
      }),
    },
  });
  if (images) {
    await tx.productImage.deleteMany({ where: { productId: id } });
    await tx.productImage.createMany({
      data: imageRows(storage, images).map((i) => ({ ...i, productId: id })),
    });
  }
  const ownVariantIds = new Set(existing.variants.map((v) => v.id));
  for (const v of variants ?? []) {
    if (!isVariantPatch(v)) {
      await createVariant(tx, id, v, actorId);
      continue;
    }
    if (!ownVariantIds.has(v.id)) {
      throw new AppError("NOT_FOUND", "That variant isn't part of this product.");
    }
    const { id: variantId, ...patch } = v;
    await tx.productVariant.update({ where: { id: variantId }, data: patch });
  }
  const updated = await loadAdminProduct(tx, id);
  if (updated.status === "ACTIVE" && !updated.variants.some((v) => v.isActive)) {
    throw new AppError("VALIDATION_ERROR", "An active product needs at least one active variant.");
  }
  return updated;
}
