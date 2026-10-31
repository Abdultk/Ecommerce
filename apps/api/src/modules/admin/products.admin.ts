import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  AdminCategoryInput,
  AdminProductInput,
  AdminProductQuery,
  AdminProductUpdate,
  PresignInput,
  ok,
  paged,
  type PresignResult,
} from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { pathParam } from "../../lib/params";
import { prisma, type DbClient } from "../../lib/prisma";
import type { ImageStorage } from "../../lib/storage";
import { revalidateSite } from "../../lib/revalidate";
import { requirePermission } from "../../middleware/authenticate";
import { audit } from "./audit";
import {
  auditSnapshot,
  createAdminProduct,
  listAdminProducts,
  loadAdminProduct,
  toAdminProductDetail,
  updateAdminProduct,
} from "./products.admin.service";

const EXTENSIONS: Record<PresignInput["contentType"], string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** /admin/products and /admin/uploads. */
export function productsAdminRouter(storage: ImageStorage): Router {
  const router = Router();
  const read = requirePermission("product:read");
  const write = requirePermission("product:write");

  router.get("/products", read, async (req, res) => {
    const query = AdminProductQuery.parse(req.query);
    const { items, total } = await listAdminProducts(prisma, query);
    res.json(paged(items, { page: query.page, pageSize: query.pageSize, total }));
  });

  router.get("/products/:id", read, async (req, res) => {
    res.json(ok(toAdminProductDetail(await loadAdminProduct(prisma, pathParam(req, "id")))));
  });

  router.post("/products", write, async (req, res) => {
    const input = AdminProductInput.parse(req.body);
    const product = await prisma.$transaction(async (tx) => {
      const created = await createAdminProduct(tx, storage, input, req.user!.sub);
      await audit(tx, req, {
        action: "product.create",
        entity: "Product",
        entityId: created.id,
        after: auditSnapshot(created),
      });
      return created;
    });
    void revalidateSite("products");
    res.status(201).json(ok(toAdminProductDetail(product)));
  });

  router.patch("/products/:id", write, async (req, res) => {
    const input = AdminProductUpdate.parse(req.body);
    const product = await prisma.$transaction(async (tx) => {
      const before = await loadAdminProduct(tx, pathParam(req, "id"));
      const updated = await updateAdminProduct(
        tx,
        storage,
        pathParam(req, "id"),
        input,
        req.user!.sub,
      );
      await audit(tx, req, {
        action: "product.update",
        entity: "Product",
        entityId: updated.id,
        before: auditSnapshot(before),
        after: auditSnapshot(updated),
      });
      return updated;
    });
    void revalidateSite("products", `product:${product.slug}`);
    res.json(ok(toAdminProductDetail(product)));
  });

  // Products are archived, never deleted: past orders and the stock ledger refer to them.
  router.delete("/products/:id", requirePermission("product:delete"), async (req, res) => {
    const product = await prisma.$transaction(async (tx) => {
      const before = await loadAdminProduct(tx, pathParam(req, "id"));
      await tx.product.update({ where: { id: before.id }, data: { status: "ARCHIVED" } });
      await audit(tx, req, {
        action: "product.archive",
        entity: "Product",
        entityId: before.id,
        before: { status: before.status },
        after: { status: "ARCHIVED" },
      });
      return loadAdminProduct(tx, before.id);
    });
    void revalidateSite("products", `product:${product.slug}`);
    res.json(ok(toAdminProductDetail(product)));
  });

  // The browser uploads straight to storage; the key is then sent with the product.
  router.post("/uploads/presign", write, async (req, res) => {
    const input = PresignInput.parse(req.body);
    const year = new Date().getUTCFullYear();
    const key = `products/${year}/${randomUUID()}.${EXTENSIONS[input.contentType]}`;
    const result: PresignResult = {
      uploadUrl: await storage.presignUpload({ key, ...input }),
      key,
      publicUrl: storage.publicUrl(key),
    };
    res.json(ok(result));
  });

  return router;
}

// ---------- Categories ----------

const MAX_CATEGORY_DEPTH = 50;

/** True if `candidateParent` is `categoryId` itself or one of its descendants. */
async function wouldCreateCycle(db: DbClient, categoryId: string, candidateParent: string) {
  let current: string | null = candidateParent;
  for (let depth = 0; current && depth < MAX_CATEGORY_DEPTH; depth += 1) {
    if (current === categoryId) return true;
    const row: { parentId: string | null } | null = await db.category.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    current = row?.parentId ?? null;
  }
  return false;
}

async function assertParent(db: DbClient, parentId: string | null, selfId?: string) {
  if (!parentId) return;
  if (!(await db.category.findUnique({ where: { id: parentId } }))) {
    throw new AppError("VALIDATION_ERROR", "Choose an existing parent category.");
  }
  if (selfId && (await wouldCreateCycle(db, selfId, parentId))) {
    throw new AppError("VALIDATION_ERROR", "A category can't be placed inside itself.");
  }
}

/** /admin/categories. The storefront's GET /categories serves the tree for reading. */
export function categoriesAdminRouter(): Router {
  const router = Router();
  router.use(requirePermission("product:write"));

  router.post("/", async (req, res) => {
    const input = AdminCategoryInput.parse(req.body);
    const category = await prisma.$transaction(async (tx) => {
      await assertParent(tx, input.parentId);
      const created = await tx.category.create({ data: input });
      await audit(tx, req, {
        action: "category.create",
        entity: "Category",
        entityId: created.id,
        after: created,
      });
      return created;
    });
    void revalidateSite("categories");
    res.status(201).json(ok(category));
  });

  router.patch("/:id", async (req, res) => {
    const input = AdminCategoryInput.parse(req.body);
    const category = await prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id: pathParam(req, "id") } });
      if (!before) throw new AppError("NOT_FOUND", "Category not found.");
      await assertParent(tx, input.parentId, before.id);
      const updated = await tx.category.update({ where: { id: before.id }, data: input });
      await audit(tx, req, {
        action: "category.update",
        entity: "Category",
        entityId: before.id,
        before,
        after: updated,
      });
      return updated;
    });
    void revalidateSite("categories");
    res.json(ok(category));
  });

  router.delete("/:id", async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({
        where: { id: pathParam(req, "id") },
        include: { _count: { select: { products: true, children: true } } },
      });
      if (!before) throw new AppError("NOT_FOUND", "Category not found.");
      if (before._count.products > 0 || before._count.children > 0) {
        throw new AppError("CONFLICT", "Move this category's products and subcategories first.");
      }
      await tx.category.delete({ where: { id: before.id } });
      const { _count: _ignored, ...snapshot } = before;
      await audit(tx, req, {
        action: "category.delete",
        entity: "Category",
        entityId: before.id,
        before: snapshot,
      });
    });
    void revalidateSite("categories");
    res.json(ok({ deleted: true }));
  });

  return router;
}
