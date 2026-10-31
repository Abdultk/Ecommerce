import { Router, type RequestHandler } from "express";
import { ProductQuery, Slug, ok, paged } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { getCategoryTree, getProductBySlug } from "./catalog.service";
import { productFacets, searchProducts } from "./search.repository";

// Public catalog responses can be cached briefly by browsers and the CDN.
const PUBLIC_CACHE = "public, max-age=60, stale-while-revalidate=300";

/** Applied per route: this router is mounted at "/", so a router-level middleware would
 * also run for requests that fall through to /admin or the 404 handler. */
const cacheable: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", PUBLIC_CACHE);
  next();
};

export function catalogRouter(): Router {
  const router = Router();

  router.get("/categories", cacheable, async (_req, res) => {
    res.json(ok(await getCategoryTree(prisma)));
  });

  router.get("/products", cacheable, async (req, res) => {
    const { items, meta } = await searchProducts(prisma, ProductQuery.parse(req.query));
    res.json(paged(items, meta));
  });

  router.get("/products/facets", cacheable, async (req, res) => {
    res.json(ok(await productFacets(prisma, ProductQuery.parse(req.query))));
  });

  router.get("/products/:slug", cacheable, async (req, res) => {
    const slug = Slug.safeParse(req.params.slug);
    if (!slug.success) throw new AppError("NOT_FOUND", "Product not found.");
    res.json(ok(await getProductBySlug(prisma, slug.data)));
  });

  return router;
}
