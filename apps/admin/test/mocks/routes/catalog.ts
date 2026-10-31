import { http, HttpResponse } from "msw";
import {
  AdminCategoryInput,
  AdminProductInput,
  AdminProductQuery,
  AdminProductUpdate,
  PresignInput,
  type AdminProductDetail,
  type AdminProductListItem,
  type AdminVariant,
  type AdminVariantInput,
  type Category,
} from "@hp/contracts";
import type { z } from "zod";
import {
  authorize,
  errorResponse,
  invalid,
  okResponse,
  pagedResponse,
  queryOf,
  readJson,
  replaceById,
  withAudit,
  type MockContext,
} from "../http";
import { imageUrlForKey, toProductListItem } from "../products";
import type { MockCategory, MockDb, MockMovement } from "../types";

// Mirrors apps/api/src/modules/admin/products.admin.ts and the public GET /categories.

const EXTENSIONS: Record<PresignInput["contentType"], string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

type ProductQuery = z.infer<typeof AdminProductQuery>;
type ImageInputs = NonNullable<AdminProductUpdate["images"]>;

const SORTERS: Record<
  ProductQuery["sort"],
  (a: AdminProductListItem, b: AdminProductListItem) => number
> = {
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => a.fromPriceCents - b.fromPriceCents,
  stock: (a, b) => a.stockAvailable - b.stockAvailable,
  updatedAt: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
};

/** Stand-in for the API's HTML sanitizer: drops scripts and inline event handlers. */
const sanitize = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");

function listProducts(db: MockDb, q: ProductQuery): AdminProductListItem[] {
  const term = q.q?.toLowerCase();
  const sorter = SORTERS[q.sort];
  return db.products
    .filter(
      (p) =>
        (!term || p.name.toLowerCase().includes(term) || p.slug.includes(term)) &&
        (!q.status || p.status === q.status) &&
        (!q.categoryId || p.categoryId === q.categoryId),
    )
    .map((p) => toProductListItem(p, db.categories))
    .filter((row) => !q.lowStock || row.lowStock)
    .sort((a, b) => (q.dir === "asc" ? sorter(a, b) : sorter(b, a)) || a.id.localeCompare(b.id));
}

export function categoryTree(categories: readonly MockCategory[]): Category[] {
  const childrenOf = (parentId: string | null): Category[] =>
    categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((c) => ({ id: c.id, slug: c.slug, name: c.name, children: childrenOf(c.id) }));
  return childrenOf(null);
}

function wouldCreateCycle(categories: readonly MockCategory[], selfId: string, parentId: string) {
  let current: string | null = parentId;
  while (current) {
    if (current === selfId) return true;
    current = categories.find((c) => c.id === current)?.parentId ?? null;
  }
  return false;
}

/** Validation shared by create and update: category, unique slug and SKUs, active variant. */
function productConflict(
  db: MockDb,
  next: Pick<AdminProductDetail, "id" | "slug" | "categoryId" | "status" | "variants">,
): Response | null {
  if (!db.categories.some((c) => c.id === next.categoryId)) {
    return errorResponse("VALIDATION_ERROR", "Choose an existing category.");
  }
  if (db.products.some((p) => p.id !== next.id && p.slug === next.slug)) {
    return errorResponse("CONFLICT", `Another product already uses the slug "${next.slug}".`);
  }
  const otherSkus = new Set(
    db.products
      .filter((p) => p.id !== next.id)
      .flatMap((p) => p.variants.map((v) => v.sku.toUpperCase())),
  );
  const clash = next.variants.find((v) => otherSkus.has(v.sku.toUpperCase()));
  if (clash) return errorResponse("CONFLICT", `SKU ${clash.sku} is already in use.`);
  if (next.status === "ACTIVE" && !next.variants.some((v) => v.isActive)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "An active product needs at least one active variant.",
    );
  }
  return null;
}

export function catalogRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;

  const newVariant = (input: AdminVariantInput): AdminVariant => {
    const { initialStock, ...rest } = input;
    return { ...rest, id: ctx.nextId("var"), stockOnHand: initialStock, stockReserved: 0 };
  };

  const restocks = (
    before: readonly AdminVariant[],
    after: readonly AdminVariant[],
    actor: string,
  ) =>
    after
      .filter((v) => !before.some((b) => b.id === v.id) && v.stockOnHand > 0)
      .map((v): MockMovement => ({
        id: ctx.nextId("mov"),
        variantId: v.id,
        delta: v.stockOnHand,
        reason: "RESTOCK",
        note: "Initial stock",
        orderNumber: null,
        actorEmail: actor,
        createdAt: ctx.now(),
      }));

  const toImages = (images: ImageInputs) =>
    images.map((img) => ({
      id: ctx.nextId("img"),
      key: img.key,
      url: imageUrlForKey(img.key),
      alt: img.alt,
      position: img.position,
    }));

  return [
    http.get(`${baseUrl}/categories`, () => okResponse(categoryTree(store.get().categories))),

    http.get(`${baseUrl}/admin/products`, ({ request }) => {
      const caller = authorize(ctx, request, "product:read");
      if (caller instanceof Response) return caller;
      const query = AdminProductQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      return pagedResponse(
        listProducts(store.get(), query.data),
        query.data.page,
        query.data.pageSize,
      );
    }),

    http.get(`${baseUrl}/admin/products/:id`, ({ request, params }) => {
      const caller = authorize(ctx, request, "product:read");
      if (caller instanceof Response) return caller;
      const product = store.get().products.find((p) => p.id === params.id);
      return product ? okResponse(product) : errorResponse("NOT_FOUND", "Product not found.");
    }),

    http.post(`${baseUrl}/admin/products`, async ({ request }) => {
      const caller = authorize(ctx, request, "product:write");
      if (caller instanceof Response) return caller;
      const input = AdminProductInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const now = ctx.now();
      const { images, variants, description, ...fields } = input.data;
      const product: AdminProductDetail = {
        ...fields,
        id: ctx.nextId("prod"),
        description: sanitize(description),
        images: toImages(images),
        variants: variants.map(newVariant),
        createdAt: now,
        updatedAt: now,
      };
      const conflict = productConflict(store.get(), product);
      if (conflict) return conflict;
      store.update((db) =>
        withAudit(
          ctx,
          {
            ...db,
            products: [...db.products, product],
            movements: [...restocks([], product.variants, caller.user.email), ...db.movements],
          },
          {
            actor: caller,
            action: "product.create",
            entity: "Product",
            entityId: product.id,
            before: null,
            after: { name: product.name, status: product.status },
          },
        ),
      );
      return okResponse(product, 201);
    }),

    http.patch(`${baseUrl}/admin/products/:id`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "product:write");
      if (caller instanceof Response) return caller;
      const input = AdminProductUpdate.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const before = store.get().products.find((p) => p.id === params.id);
      if (!before) return errorResponse("NOT_FOUND", "Product not found.");

      const { variants: variantChanges = [], images, description, ...fields } = input.data;
      let variants: AdminVariant[] = [...before.variants];
      for (const change of variantChanges) {
        if ("id" in change && typeof change.id === "string") {
          const current = variants.find((v) => v.id === change.id);
          if (!current)
            return errorResponse("NOT_FOUND", "That variant isn't part of this product.");
          variants = replaceById(variants, { ...current, ...change });
        } else {
          variants = [...variants, newVariant(change as AdminVariantInput)];
        }
      }
      const product: AdminProductDetail = {
        ...before,
        ...fields,
        ...(description !== undefined && { description: sanitize(description) }),
        ...(images !== undefined && { images: toImages(images) }),
        variants,
        updatedAt: ctx.now(),
      };
      const conflict = productConflict(store.get(), product);
      if (conflict) return conflict;
      store.update((db) =>
        withAudit(
          ctx,
          {
            ...db,
            products: replaceById(db.products, product),
            movements: [...restocks(before.variants, variants, caller.user.email), ...db.movements],
          },
          {
            actor: caller,
            action: "product.update",
            entity: "Product",
            entityId: product.id,
            before: { name: before.name, status: before.status },
            after: { name: product.name, status: product.status },
          },
        ),
      );
      return okResponse(product);
    }),

    http.delete(`${baseUrl}/admin/products/:id`, ({ request, params }) => {
      const caller = authorize(ctx, request, "product:delete");
      if (caller instanceof Response) return caller;
      const before = store.get().products.find((p) => p.id === params.id);
      if (!before) return errorResponse("NOT_FOUND", "Product not found.");
      const archived: AdminProductDetail = { ...before, status: "ARCHIVED", updatedAt: ctx.now() };
      store.update((db) =>
        withAudit(
          ctx,
          { ...db, products: replaceById(db.products, archived) },
          {
            actor: caller,
            action: "product.archive",
            entity: "Product",
            entityId: before.id,
            before: { status: before.status },
            after: { status: "ARCHIVED" },
          },
        ),
      );
      return okResponse(archived);
    }),

    http.post(`${baseUrl}/admin/uploads/presign`, async ({ request }) => {
      const caller = authorize(ctx, request, "product:write");
      if (caller instanceof Response) return caller;
      const input = PresignInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const key = `products/${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${EXTENSIONS[input.data.contentType]}`;
      return okResponse({
        uploadUrl: `${baseUrl}/mock-uploads/${key}`,
        key,
        publicUrl: imageUrlForKey(key),
      });
    }),

    // Stands in for the storage bucket the presigned URL points at.
    http.put(`${baseUrl}/mock-uploads/*`, () => new HttpResponse(null, { status: 200 })),

    http.post(`${baseUrl}/admin/categories`, async ({ request }) => {
      const caller = authorize(ctx, request, "product:write");
      if (caller instanceof Response) return caller;
      const input = AdminCategoryInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const db = store.get();
      if (input.data.parentId && !db.categories.some((c) => c.id === input.data.parentId)) {
        return errorResponse("VALIDATION_ERROR", "Choose an existing parent category.");
      }
      if (db.categories.some((c) => c.slug === input.data.slug)) {
        return errorResponse("CONFLICT", "That slug is already in use.");
      }
      const created: MockCategory = { ...input.data, id: ctx.nextId("cat") };
      store.update((current) =>
        withAudit(
          ctx,
          { ...current, categories: [...current.categories, created] },
          {
            actor: caller,
            action: "category.create",
            entity: "Category",
            entityId: created.id,
            before: null,
            after: created,
          },
        ),
      );
      return okResponse(created, 201);
    }),

    http.patch(`${baseUrl}/admin/categories/:id`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "product:write");
      if (caller instanceof Response) return caller;
      const input = AdminCategoryInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const db = store.get();
      const before = db.categories.find((c) => c.id === params.id);
      if (!before) return errorResponse("NOT_FOUND", "Category not found.");
      const { parentId } = input.data;
      if (parentId && !db.categories.some((c) => c.id === parentId)) {
        return errorResponse("VALIDATION_ERROR", "Choose an existing parent category.");
      }
      if (parentId && wouldCreateCycle(db.categories, before.id, parentId)) {
        return errorResponse("VALIDATION_ERROR", "A category can't be placed inside itself.");
      }
      if (db.categories.some((c) => c.id !== before.id && c.slug === input.data.slug)) {
        return errorResponse("CONFLICT", "That slug is already in use.");
      }
      const updated: MockCategory = { ...before, ...input.data };
      store.update((current) =>
        withAudit(
          ctx,
          { ...current, categories: replaceById(current.categories, updated) },
          {
            actor: caller,
            action: "category.update",
            entity: "Category",
            entityId: before.id,
            before,
            after: updated,
          },
        ),
      );
      return okResponse(updated);
    }),

    http.delete(`${baseUrl}/admin/categories/:id`, ({ request, params }) => {
      const caller = authorize(ctx, request, "product:write");
      if (caller instanceof Response) return caller;
      const db = store.get();
      const before = db.categories.find((c) => c.id === params.id);
      if (!before) return errorResponse("NOT_FOUND", "Category not found.");
      if (
        db.categories.some((c) => c.parentId === before.id) ||
        db.products.some((p) => p.categoryId === before.id)
      ) {
        return errorResponse("CONFLICT", "Move this category's products and subcategories first.");
      }
      store.update((current) =>
        withAudit(
          ctx,
          { ...current, categories: current.categories.filter((c) => c.id !== before.id) },
          {
            actor: caller,
            action: "category.delete",
            entity: "Category",
            entityId: before.id,
            before,
            after: null,
          },
        ),
      );
      return okResponse({ deleted: true });
    }),
  ];
}
