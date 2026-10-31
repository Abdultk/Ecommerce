import { Router } from "express";
import { z } from "zod";
import type { Review as ReviewRow, User } from "@prisma/client";
import { REFUNDABLE_STATUSES, ReviewInput, Slug, ok, paged, type Review } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { prisma, type DbClient } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";

const ReviewQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/** "Ada C." — never the full surname or email. */
const authorName = (user: Pick<User, "firstName" | "lastName">) =>
  `${user.firstName} ${user.lastName.charAt(0)}.`.trim();

const toReview = (r: ReviewRow & { user: Pick<User, "firstName" | "lastName"> }): Review => ({
  id: r.id,
  rating: r.rating,
  title: r.title,
  body: r.body,
  authorName: authorName(r.user),
  verifiedPurchase: true, // only verified purchasers can post
  createdAt: r.createdAt.toISOString(),
});

async function activeProduct(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug: Slug.parse(slug), status: "ACTIVE" },
  });
  if (!product) throw new AppError("NOT_FOUND", "Product not found.");
  return product;
}

/** A paid order (not cancelled or refunded) that contained one of the product's variants. */
async function hasBought(userId: string, productId: string): Promise<boolean> {
  const count = await prisma.orderItem.count({
    where: {
      variantId: {
        in: (
          await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })
        ).map((v) => v.id),
      },
      order: { userId, status: { in: [...REFUNDABLE_STATUSES] } },
    },
  });
  return count > 0;
}

/** Keeps the denormalized rating on the product in step with its visible reviews. */
export async function refreshRating(tx: DbClient, productId: string) {
  const stats = await tx.review.aggregate({
    where: { productId, isVisible: true },
    _avg: { rating: true },
    _count: true,
  });
  await tx.product.update({
    where: { id: productId },
    data: { ratingAvg: stats._avg.rating ?? 0, ratingCount: stats._count },
  });
}

/** Mounted at /products/:slug/reviews. */
export function reviewsRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const { slug } = req.params as { slug: string };
    const query = ReviewQuery.parse(req.query);
    const product = await activeProduct(slug);
    const where = { productId: product.id, isVisible: true };
    const [rows, total] = await Promise.all([
      prisma.review.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.review.count({ where }),
    ]);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(paged(rows.map(toReview), { page: query.page, pageSize: query.pageSize, total }));
  });

  router.post("/", authenticate, async (req, res) => {
    const { slug } = req.params as { slug: string };
    const input = ReviewInput.parse(req.body);
    const userId = req.user!.sub;
    const product = await activeProduct(slug);
    if (!(await hasBought(userId, product.id))) {
      throw new AppError("FORBIDDEN", "Only customers who bought this product can review it.");
    }
    const existing = await prisma.review.findUnique({
      where: { productId_userId: { productId: product.id, userId } },
    });
    if (existing) throw new AppError("CONFLICT", "You've already reviewed this product.");

    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: { productId: product.id, userId, ...input },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      await refreshRating(tx, product.id);
      return created;
    });
    res.status(201).json(ok(toReview(review)));
  });

  return router;
}
