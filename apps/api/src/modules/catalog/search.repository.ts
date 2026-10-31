import { Prisma } from "@prisma/client";
import type {
  PageMeta,
  ProductFacets,
  ProductQuery,
  ProductSort,
  ProductSummary,
} from "@hp/contracts";
import { currentLang } from "../../lib/locale";
import type { Db, DbClient } from "../../lib/prisma";

// Postgres full-text search (weighted tsvector maintained by trigger) plus trigram
// word similarity for typos. Every user value is a bound parameter via Prisma.sql.
// Typo matching uses the `<%` operator so the GIN trigram index on "name" can be used;
// its cut-off is the pg_trgm.word_similarity_threshold setting, set per transaction.

const WORD_SIMILARITY_THRESHOLD = 0.4;

/** Runs a search with the trigram threshold set for this transaction only (SET LOCAL semantics). */
function withTrigramThreshold<T>(
  db: Db,
  q: ProductQuery,
  run: (tx: DbClient) => Promise<T>,
): Promise<T> {
  if (!q.q) return run(db);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(WORD_SIMILARITY_THRESHOLD)}, true)`;
    return run(tx);
  });
}

const PRICE_BUCKETS: readonly { minCents: number; maxCents: number | null }[] = [
  { minCents: 0, maxCents: 2_500 },
  { minCents: 2_500, maxCents: 5_000 },
  { minCents: 5_000, maxCents: 10_000 },
  { minCents: 10_000, maxCents: 20_000 },
  { minCents: 20_000, maxCents: null },
];

const ORDER_BY: Record<ProductSort, Prisma.Sql> = {
  relevance: Prisma.sql`rank DESC, p."salesCount" DESC, p.id`,
  price_asc: Prisma.sql`v.from_price ASC, p.id`,
  price_desc: Prisma.sql`v.from_price DESC, p.id`,
  newest: Prisma.sql`p."createdAt" DESC, p.id`,
  popular: Prisma.sql`p."salesCount" DESC, p."ratingCount" DESC, p.id`,
};

/** Price per product = cheapest active variant; availability = sum over active variants. */
const VARIANT_ROLLUP = Prisma.sql`
  WITH v AS (
    SELECT "productId",
           MIN("priceCents")::int AS from_price,
           SUM("stockOnHand" - "stockReserved")::int AS available
    FROM "ProductVariant"
    WHERE "isActive"
    GROUP BY "productId"
  )`;

const FROM = Prisma.sql`
  FROM "Product" p
  JOIN "Category" c ON c.id = p."categoryId"
  LEFT JOIN "Category" pc ON pc.id = c."parentId"
  JOIN v ON v."productId" = p.id`;

const tsQuery = (q: string) => Prisma.sql`websearch_to_tsquery('english', ${q})`;

/** Facet counts ignore the facet filters themselves so shoppers can widen a selection. */
function whereClause(q: ProductQuery, { facetFilters }: { facetFilters: boolean }): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`];

  if (q.q) {
    const arabicName =
      currentLang() === "ar"
        ? Prisma.sql` OR (p.translations #>> '{ar,name}') ILIKE ${`%${q.q.replace(/[\\%_]/g, "\\$&")}%`}`
        : Prisma.empty;
    conditions.push(
      Prisma.sql`(p."searchVector" @@ ${tsQuery(q.q)} OR ${q.q} <% p.name${arabicName})`,
    );
  }
  if (q.category) conditions.push(Prisma.sql`(c.slug = ${q.category} OR pc.slug = ${q.category})`);
  if (q.inStock !== undefined) conditions.push(Prisma.sql`(v.available > 0) = ${q.inStock}`);
  if (q.inductionCompatible !== undefined) {
    conditions.push(
      Prisma.sql`COALESCE(p."inductionCompatible", false) = ${q.inductionCompatible}`,
    );
  }

  if (facetFilters) {
    if (q.brand?.length) conditions.push(Prisma.sql`p.brand = ANY(${q.brand})`);
    if (q.material?.length) conditions.push(Prisma.sql`p.material = ANY(${q.material})`);
    if (q.minPrice !== undefined) conditions.push(Prisma.sql`v.from_price >= ${q.minPrice}`);
    if (q.maxPrice !== undefined) conditions.push(Prisma.sql`v.from_price <= ${q.maxPrice}`);
  }

  return Prisma.join(conditions, " AND ");
}

type SummaryRow = Omit<ProductSummary, "ratingAvg"> & { ratingAvg: number; total: bigint };

/** Product name in the shopper's language (English base text when there is no translation). */
const localizedName = (): Prisma.Sql =>
  currentLang() === "ar"
    ? Prisma.sql`COALESCE(NULLIF(p.translations #>> '{ar,name}', ''), p.name)`
    : Prisma.sql`p.name`;

const summaryColumns = (): Prisma.Sql => Prisma.sql`
  p.id, p.slug, ${localizedName()} AS name, p.brand,
  c.slug AS "categorySlug",
  v.from_price AS "fromPriceCents",
  (v.available > 0) AS "inStock",
  p."ratingAvg"::float AS "ratingAvg",
  p."ratingCount",
  (SELECT i.url FROM "ProductImage" i WHERE i."productId" = p.id ORDER BY i.position LIMIT 1) AS "thumbnailUrl"`;

/** Active products with the given ids, in the order the ids were given (missing ones skipped). */
export async function productSummariesByIds(
  db: DbClient,
  ids: readonly string[],
): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db.$queryRaw<ProductSummary[]>`
    ${VARIANT_ROLLUP}
    SELECT ${summaryColumns()}
    ${FROM}
    WHERE p.status = 'ACTIVE' AND p.id = ANY(${[...ids]})`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export function searchProducts(
  db: Db,
  q: ProductQuery,
): Promise<{ items: ProductSummary[]; meta: PageMeta }> {
  return withTrigramThreshold(db, q, (tx) => searchPage(tx, q));
}

async function searchPage(
  db: DbClient,
  q: ProductQuery,
): Promise<{ items: ProductSummary[]; meta: PageMeta }> {
  const rank = q.q
    ? Prisma.sql`ts_rank(p."searchVector", ${tsQuery(q.q)}) + word_similarity(${q.q}, p.name)`
    : Prisma.sql`0`;
  const offset = (q.page - 1) * q.pageSize;

  const rows = await db.$queryRaw<SummaryRow[]>`
    ${VARIANT_ROLLUP}
    SELECT ${summaryColumns()},
           ${rank} AS rank,
           COUNT(*) OVER() AS total
    ${FROM}
    WHERE ${whereClause(q, { facetFilters: true })}
    ORDER BY ${ORDER_BY[q.sort]}
    LIMIT ${q.pageSize} OFFSET ${offset}`;

  const total = Number(rows[0]?.total ?? 0);
  const items = rows.map(
    ({ total: _total, rank: _rank, ...row }: SummaryRow & { rank?: unknown }): ProductSummary =>
      row,
  );
  return {
    items,
    meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
  };
}

type FacetRow = {
  facet: "brand" | "material" | "price";
  value: string;
  label: string | null;
  count: number;
};

/** Lower bounds of every price bucket after the first, for width_bucket(). */
const PRICE_BOUNDS = PRICE_BUCKETS.slice(1).map((b) => b.minCents);

const byCount = (rows: FacetRow[], facet: FacetRow["facet"]) =>
  rows
    .filter((r) => r.facet === facet)
    .map(({ value, label, count }) => ({ value, ...(label ? { label } : {}), count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

/**
 * Facet counts computed in SQL with GROUP BY over the matching products: one row per
 * brand, material and price bucket (width_bucket over the bucket bounds). Facet filters
 * are left out of the match so shoppers can widen a selection.
 */
export function productFacets(db: Db, q: ProductQuery): Promise<ProductFacets> {
  return withTrigramThreshold(db, q, async (tx) => {
    const rows = await tx.$queryRaw<FacetRow[]>`
      ${VARIANT_ROLLUP},
      matched AS (
        SELECT p.brand, p.material, p.translations #>> '{ar,material}' AS material_ar, width_bucket(v.from_price, ${PRICE_BOUNDS}::int[]) AS bucket
        ${FROM}
        WHERE ${whereClause(q, { facetFilters: false })})
      SELECT 'brand' AS facet, brand AS value, NULL AS label, COUNT(*)::int AS count
        FROM matched WHERE brand IS NOT NULL GROUP BY brand
      UNION ALL
      SELECT 'material', material, ${currentLang() === "ar" ? Prisma.sql`MIN(material_ar)` : Prisma.sql`NULL`}, COUNT(*)::int FROM matched WHERE material IS NOT NULL GROUP BY material
      UNION ALL
      SELECT 'price', bucket::text, NULL, COUNT(*)::int FROM matched GROUP BY bucket`;
    const priceCounts = new Map(
      rows.filter((r) => r.facet === "price").map((r) => [Number(r.value), r.count]),
    );
    return {
      brands: byCount(rows, "brand"),
      materials: byCount(rows, "material"),
      priceRanges: PRICE_BUCKETS.map((bucket, i) => ({
        ...bucket,
        count: priceCounts.get(i) ?? 0,
      })),
    };
  });
}
