import { http, HttpResponse } from "msw";
import { z } from "zod";
import { Page, REFUNDABLE_STATUSES, Review, ReviewInput, ok, paged } from "@hp/contracts";
import { errorResponse, readJson, requestUser, validationError, type MockStore } from "./state";

export const REVIEWS_PAGE_SIZE = 10;

const ReviewQuery = z.object({
  page: Page,
  pageSize: z.coerce.number().int().min(1).max(50).default(REVIEWS_PAGE_SIZE),
});

export function createReviewHandlers(store: MockStore) {
  const { baseUrl, products } = store;

  /** A paid (not cancelled or refunded) order containing one of the product's variants. */
  const paidStatuses: ReadonlySet<string> = new Set(REFUNDABLE_STATUSES);
  const hasBought = (userId: string, productId: string) => {
    const variantIds = new Set(products.find((p) => p.id === productId)?.variants.map((v) => v.id));
    return store
      .get()
      .orders.some(
        (o) =>
          o.ownerId === userId &&
          paidStatuses.has(o.detail.status) &&
          o.detail.items.some((item) => variantIds.has(item.variantId)),
      );
  };

  return [
    http.get(`${baseUrl}/products/:slug/reviews`, ({ request, params }) => {
      const product = products.find((p) => p.slug === params.slug);
      if (!product) return errorResponse("NOT_FOUND", "Product not found.");
      const parsed = ReviewQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
      const { page, pageSize } = parsed.data;
      const all = store.get().reviews[product.slug] ?? [];
      const start = (page - 1) * pageSize;
      return HttpResponse.json(
        paged(all.slice(start, start + pageSize), { page, pageSize, total: all.length }),
      );
    }),

    http.post(`${baseUrl}/products/:slug/reviews`, async ({ request, params }) => {
      const product = products.find((p) => p.slug === params.slug);
      if (!product) return errorResponse("NOT_FOUND", "Product not found.");
      const user = requestUser(request, store);
      if (!user) return errorResponse("UNAUTHENTICATED", "Please sign in.");
      const parsed = ReviewInput.safeParse(await readJson(request));
      if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
      if (!hasBought(user.id, product.id)) {
        return errorResponse("FORBIDDEN", "Only customers who bought this product can review it.");
      }
      const key = `${user.id}:${product.slug}`;
      if (store.get().reviewed.includes(key)) {
        return errorResponse("CONFLICT", "You've already reviewed this product.");
      }
      const review = Review.parse({
        ...parsed.data,
        id: store.id("rev"),
        authorName: `${user.firstName} ${user.lastName.charAt(0)}.`,
        verifiedPurchase: true,
        createdAt: new Date().toISOString(),
      });
      store.update((s) => ({
        ...s,
        reviewed: [...s.reviewed, key],
        reviews: { ...s.reviews, [product.slug]: [review, ...(s.reviews[product.slug] ?? [])] },
      }));
      return HttpResponse.json(ok(review), { status: 201 });
    }),
  ];
}
