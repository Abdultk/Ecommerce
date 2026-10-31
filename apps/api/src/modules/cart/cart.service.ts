import { localized } from "../../lib/locale";
import type { Request, Response } from "express";
import type { Cart as CartRow } from "@prisma/client";
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  type Cart,
  type CartLine,
  type CurrencyCode,
} from "@hp/contracts";
import { currencyOf, loadSettings } from "../settings/settings.service";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma, type DbClient } from "../../lib/prisma";
import { evaluateCoupon } from "./coupons";
import { computeTotals, type PricedLine } from "./pricing";

const CART_COOKIE = "hp_cart";
/** Sent to /cart and /checkout alike; httpOnly + signed, so the wider path exposes nothing. */
const CART_COOKIE_PATH = "/api/v1";
const GUEST_CART_TTL_MS = 30 * 24 * 3600_000;
/** Placeholder id for a guest who hasn't added anything; nothing is stored yet. */
const UNSAVED_CART_ID = "guest";

const ITEM_GONE = "That item is no longer available.";
const CART_FULL = `Your cart can hold up to ${MAX_CART_LINES} different items.`;
const NOT_IN_CART = "That item isn't in your cart.";

// ---------- Cart identity ----------

const cookieOptions = () => ({
  signed: true,
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: CART_COOKIE_PATH,
});

export function guestCartId(req: Request): string | undefined {
  const value: unknown = req.signedCookies?.[CART_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined; // tampered → false
}

export function clearGuestCookie(res: Response) {
  // Not `signed`: Express would otherwise write a signed empty value instead of clearing it.
  const { signed: _signed, ...options } = cookieOptions();
  res.clearCookie(CART_COOKIE, options);
}

/** The current cart for this request, or null if none exists yet. Never creates one. */
export async function findCart(db: DbClient, req: Request): Promise<CartRow | null> {
  if (req.user) return db.cart.findUnique({ where: { userId: req.user.sub } });
  const id = guestCartId(req);
  if (!id) return null;
  return db.cart.findFirst({ where: { id, userId: null, expiresAt: { gt: new Date() } } });
}

async function findOrCreateCart(db: DbClient, req: Request, res: Response): Promise<CartRow> {
  const existing = await findCart(db, req);
  if (existing) return existing;
  if (req.user) {
    return db.cart.upsert({
      where: { userId: req.user.sub },
      create: { userId: req.user.sub, expiresAt: new Date(Date.now() + GUEST_CART_TTL_MS) },
      update: {},
    });
  }
  const cart = await db.cart.create({
    data: { expiresAt: new Date(Date.now() + GUEST_CART_TTL_MS) },
  });
  res.cookie(CART_COOKIE, cart.id, { ...cookieOptions(), maxAge: GUEST_CART_TTL_MS });
  return cart;
}

// ---------- Reading ----------

const emptyCart = (id: string, currency: CurrencyCode): Cart => ({
  id,
  items: [],
  couponCode: null,
  totals: { subtotalCents: 0, discountCents: 0, shippingCents: 0, taxCents: 0, totalCents: 0 },
  currency,
});

async function customerRedemptions(
  db: DbClient,
  userId: string | null,
  code: string,
): Promise<number> {
  if (!userId) return 0;
  return db.order.count({
    where: { userId, couponCode: code, status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } },
  });
}

/**
 * Builds the contract view of a cart. Lines whose product was unpublished are dropped,
 * and a coupon that no longer qualifies is removed, so totals are always honest.
 * Shipping and tax are quoted at checkout, so they are 0 here.
 */
export async function cartView(db: DbClient, cart: CartRow | null): Promise<Cart> {
  const currency = currencyOf(await loadSettings(db));
  if (!cart) return emptyCart(UNSAVED_CART_ID, currency);

  const items = await db.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { createdAt: "asc" },
  });
  const variants = await db.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variantId) } },
    include: {
      product: { include: { images: { orderBy: { position: "asc" }, take: 1 } } },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  const gone = items.filter((i) => {
    const v = byId.get(i.variantId);
    return !v || !v.isActive || v.product.status !== "ACTIVE";
  });
  if (gone.length > 0)
    await db.cartItem.deleteMany({ where: { id: { in: gone.map((i) => i.id) } } });

  const lines: (CartLine & { categoryId: string })[] = items
    .filter((i) => !gone.includes(i))
    .map((item) => {
      const v = byId.get(item.variantId)!;
      return {
        id: item.id,
        variantId: v.id,
        productSlug: v.product.slug,
        productName: localized(v.product.translations, "name", v.product.name),
        variantName: localized(v.translations, "name", v.name),
        sku: v.sku,
        thumbnailUrl: v.product.images[0]?.url ?? null,
        unitPriceCents: v.priceCents,
        quantity: item.quantity,
        lineTotalCents: v.priceCents * item.quantity,
        stockAvailable: Math.max(0, v.stockOnHand - v.stockReserved),
        categoryId: v.product.categoryId,
      };
    });
  const priced: PricedLine[] = lines.map((l) => ({
    unitPriceCents: l.unitPriceCents,
    quantity: l.quantity,
    categoryId: l.categoryId,
  }));

  let couponCode = cart.couponCode;
  let rule;
  if (couponCode) {
    const coupon = await db.coupon.findUnique({ where: { code: couponCode } });
    const result = evaluateCoupon(coupon, {
      lines: priced,
      currency,
      now: new Date(),
      customerRedemptions: await customerRedemptions(db, cart.userId, couponCode),
    });
    if (result.ok) {
      rule = result.rule;
    } else {
      couponCode = null;
      await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    }
  }

  return {
    id: cart.id,
    items: lines.map(({ categoryId: _categoryId, ...line }) => line),
    couponCode,
    totals: computeTotals(priced, 0, 0, rule),
    currency,
  };
}

// ---------- Mutations ----------

async function purchasableVariant(db: DbClient, variantId: string) {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });
  if (!variant || !variant.isActive || variant.product.status !== "ACTIVE") {
    throw new AppError("NOT_FOUND", ITEM_GONE);
  }
  return variant;
}

function assertQuantityAllowed(
  quantity: number,
  variant: { stockOnHand: number; stockReserved: number; id: string; product: { name: string } },
) {
  const available = Math.max(0, variant.stockOnHand - variant.stockReserved);
  if (quantity > available) {
    throw new AppError("OUT_OF_STOCK", `Only ${available} left of ${variant.product.name}.`, {
      variantId: variant.id,
      available,
    });
  }
  if (quantity > MAX_LINE_QUANTITY) {
    throw new AppError("VALIDATION_ERROR", `You can add up to ${MAX_LINE_QUANTITY} of one item.`);
  }
}

export async function addItem(
  req: Request,
  res: Response,
  variantId: string,
  quantity: number,
): Promise<Cart> {
  const variant = await purchasableVariant(prisma, variantId);
  const cart = await findOrCreateCart(prisma, req, res);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
  });
  if (
    !existing &&
    (await prisma.cartItem.count({ where: { cartId: cart.id } })) >= MAX_CART_LINES
  ) {
    throw new AppError("VALIDATION_ERROR", CART_FULL, { maxLines: MAX_CART_LINES });
  }
  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  assertQuantityAllowed(nextQuantity, variant);

  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    create: { cartId: cart.id, variantId, quantity: nextQuantity },
    update: { quantity: nextQuantity },
  });
  return cartView(prisma, cart);
}

async function itemInCart(req: Request, itemId: string) {
  const cart = await findCart(prisma, req);
  const item = cart
    ? await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } })
    : null;
  if (!cart || !item) throw new AppError("NOT_FOUND", NOT_IN_CART);
  return { cart, item };
}

export async function updateItem(req: Request, itemId: string, quantity: number): Promise<Cart> {
  const { cart, item } = await itemInCart(req, itemId);
  assertQuantityAllowed(quantity, await purchasableVariant(prisma, item.variantId));
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return cartView(prisma, cart);
}

export async function removeItem(req: Request, itemId: string): Promise<Cart> {
  const { cart, item } = await itemInCart(req, itemId);
  await prisma.cartItem.delete({ where: { id: item.id } });
  return cartView(prisma, cart);
}

export async function applyCoupon(req: Request, res: Response, code: string): Promise<Cart> {
  const cart = await findOrCreateCart(prisma, req, res);
  const view = await cartView(prisma, cart);
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  const lines = await Promise.all(
    view.items.map(async (l) => ({
      unitPriceCents: l.unitPriceCents,
      quantity: l.quantity,
      categoryId: (
        await prisma.productVariant.findUniqueOrThrow({
          where: { id: l.variantId },
          select: { product: { select: { categoryId: true } } },
        })
      ).product.categoryId,
    })),
  );
  const currency = currencyOf(await loadSettings(prisma));
  const result = evaluateCoupon(coupon, {
    lines,
    currency,
    now: new Date(),
    customerRedemptions: await customerRedemptions(prisma, cart.userId, code),
  });
  if (!result.ok) throw new AppError("COUPON_INVALID", result.message);

  const updated = await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: code } });
  return cartView(prisma, updated);
}

export async function removeCoupon(req: Request): Promise<Cart> {
  const cart = await findCart(prisma, req);
  if (!cart) return cartView(prisma, null);
  return cartView(
    prisma,
    await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } }),
  );
}

/**
 * After sign-in, folds the guest cart into the user's cart. Quantities are summed but
 * capped by available stock and the per-line maximum; the guest cart is then deleted.
 */
export async function mergeGuestCart(req: Request, res: Response): Promise<Cart> {
  const userId = req.user!.sub;
  const guestId = guestCartId(req);

  const merged = await prisma.$transaction(async (tx) => {
    const userCart = await tx.cart.upsert({
      where: { userId },
      create: { userId, expiresAt: new Date(Date.now() + GUEST_CART_TTL_MS) },
      update: {},
    });
    const guest = guestId
      ? await tx.cart.findFirst({ where: { id: guestId, userId: null }, include: { items: true } })
      : null;
    if (!guest) return userCart;

    for (const item of guest.items) {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        include: { product: true },
      });
      if (!variant || !variant.isActive || variant.product.status !== "ACTIVE") continue;
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
      });
      if (
        !existing &&
        (await tx.cartItem.count({ where: { cartId: userCart.id } })) >= MAX_CART_LINES
      )
        continue; // the merged cart keeps the cap; extra guest lines are dropped
      const available = Math.max(0, variant.stockOnHand - variant.stockReserved);
      const quantity = Math.min(
        (existing?.quantity ?? 0) + item.quantity,
        available,
        MAX_LINE_QUANTITY,
      );
      if (quantity < 1) continue;
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
        create: { cartId: userCart.id, variantId: item.variantId, quantity },
        update: { quantity },
      });
    }
    await tx.cart.delete({ where: { id: guest.id } });
    return userCart.couponCode || !guest.couponCode
      ? userCart
      : tx.cart.update({ where: { id: userCart.id }, data: { couponCode: guest.couponCode } });
  });

  clearGuestCookie(res);
  return cartView(prisma, merged);
}
