import { Router } from "express";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { AddCartItemInput, ApplyCouponInput, UpdateCartItemInput, ok } from "@hp/contracts";
import { prisma } from "../../lib/prisma";
import { rateLimit } from "../../lib/rate-limit";
import { authenticate, optionalAuth } from "../../middleware/authenticate";
import {
  addItem,
  applyCoupon,
  cartView,
  findCart,
  mergeGuestCart,
  removeCoupon,
  removeItem,
  updateItem,
} from "./cart.service";

/** Cart for guests (signed cookie) and signed-in shoppers (bearer token). */
export function cartRouter({ couponLimiter }: { couponLimiter: RateLimiterAbstract }): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/merge", authenticate, async (req, res) => {
    res.json(ok(await mergeGuestCart(req, res)));
  });

  router.use(optionalAuth);

  router.get("/", async (req, res) => {
    res.json(ok(await cartView(prisma, await findCart(prisma, req))));
  });

  router.post("/items", async (req, res) => {
    const input = AddCartItemInput.parse(req.body);
    res.json(ok(await addItem(req, res, input.variantId, input.quantity)));
  });

  router.patch("/items/:itemId", async (req, res) => {
    const input = UpdateCartItemInput.parse(req.body);
    res.json(ok(await updateItem(req, req.params.itemId, input.quantity)));
  });

  router.delete("/items/:itemId", async (req, res) => {
    res.json(ok(await removeItem(req, req.params.itemId)));
  });

  router.post("/coupon", rateLimit(couponLimiter), async (req, res) => {
    res.json(ok(await applyCoupon(req, res, ApplyCouponInput.parse(req.body).code)));
  });

  router.delete("/coupon", async (req, res) => {
    res.json(ok(await removeCoupon(req)));
  });

  return router;
}
