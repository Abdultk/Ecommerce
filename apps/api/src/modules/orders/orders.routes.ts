import { Router } from "express";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { CustomerOrderQuery, GuestOrderLookupInput, OrderNumber, ok, paged } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { rateLimit } from "../../lib/rate-limit";
import { authenticate } from "../../middleware/authenticate";
import { lookupTokenMatches } from "./lookup-token";
import { ORDER_DETAIL_INCLUDE, toOrderDetail, toOrderSummary } from "./order-view";
import { CUSTOMER_CANCELLABLE, cancelOrder, type OrderDeps } from "./orders.service";

const NOT_FOUND = "We couldn't find that order.";

/** Order history and guest lookup for shoppers. */
export function ordersRouter(deps: OrderDeps & { lookupLimiter: RateLimiterAbstract }): Router {
  const router = Router();
  const { db } = deps;

  const ownOrder = async (number: string, userId: string) => {
    const order = await db.order.findFirst({
      where: { number: OrderNumber.parse(number), userId },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!order) throw new AppError("NOT_FOUND", NOT_FOUND);
    return order;
  };

  // Guests: the token is in the body so it stays out of URLs and logs. A wrong token and an
  // unknown order get the same answer, and attempts are limited per IP.
  router.post("/lookup", rateLimit(deps.lookupLimiter), async (req, res) => {
    const input = GuestOrderLookupInput.parse(req.body);
    const order = await db.order.findUnique({
      where: { number: input.number },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!order || !lookupTokenMatches(input.token, order)) {
      throw new AppError("NOT_FOUND", NOT_FOUND);
    }
    res.json(ok(toOrderDetail(order)));
  });

  router.use(authenticate);

  // Abandoned card checkouts (never paid) are left out of the history; bank-transfer orders
  // awaiting payment are shown, so the customer can find the bank details and deadline.
  router.get("/", async (req, res) => {
    const query = CustomerOrderQuery.parse(req.query);
    const where = {
      userId: req.user!.sub,
      OR: [
        { paidAt: { not: null } },
        {
          paymentMethod: { in: ["BANK_TRANSFER", "MANUAL"] as ("BANK_TRANSFER" | "MANUAL")[] },
          status: "PENDING_PAYMENT" as const,
        },
      ],
    };
    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.order.count({ where }),
    ]);
    res.json(
      paged(orders.map(toOrderSummary), { page: query.page, pageSize: query.pageSize, total }),
    );
  });

  router.get("/:number", async (req, res) => {
    res.json(ok(toOrderDetail(await ownOrder(req.params.number, req.user!.sub))));
  });

  router.post("/:number/cancel", async (req, res) => {
    const order = await ownOrder(req.params.number, req.user!.sub);
    await cancelOrder(deps, order.id, {
      allowed: CUSTOMER_CANCELLABLE,
      actorId: req.user!.sub,
      reason: "Cancelled by the customer.",
      mayRefund: true, // their own order
    });
    res.json(ok(toOrderDetail(await ownOrder(req.params.number, req.user!.sub))));
  });

  return router;
}
