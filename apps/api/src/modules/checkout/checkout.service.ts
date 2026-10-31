import type { Request } from "express";
import {
  Prisma,
  type Cart as CartRow,
  type Order,
  type StoreSettings as SettingsRow,
} from "@prisma/client";
import {
  formatOrderNumber,
  type CheckoutInput,
  type CheckoutIntent,
  type CheckoutPayment,
  type ShippingOption,
  type Totals,
} from "@hp/contracts";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import type { PaymentRef } from "../../lib/payments";
import { safeErrorFields } from "../../lib/safe-error";
import { capturePaymentError } from "../../lib/sentry";
import type { DbClient } from "../../lib/prisma";
import { cartView, findCart } from "../cart/cart.service";
import { evaluateCoupon } from "../cart/coupons";
import { computeTotals, type CouponRule, type PricedLine } from "../cart/pricing";
import { manualPaymentEmail, transferInstructionsEmail } from "../orders/emails";
import { lookupTokenFor, lookupTokenHash } from "../orders/lookup-token";
import {
  ORDER_DETAIL_INCLUDE,
  bankTransferOf,
  manualPaymentOf,
  toPaymentMethodRow,
} from "../orders/order-view";
import {
  cancelPaymentQuietly,
  cancelPendingInTx,
  paymentRefOf,
  type OrderDeps,
} from "../orders/orders.service";
import { lockOrder, lockVariants, reserve } from "../orders/stock";
import { sendFollowUpMail } from "../payments/payment-events";
import {
  availableMethods,
  bankOf,
  currencyOf,
  enabledManualMethods,
  loadSettings,
  lockSettings,
  shippingOf,
} from "../settings/settings.service";
import {
  checkoutFingerprint,
  clientHash,
  enforceOpenCheckoutCaps,
  lockShopper,
  reservationMs,
  type CheckoutCaps,
} from "./checkout-guards";
import { shippingCents, shippingOptions } from "./shipping";

export type CheckoutDeps = OrderDeps & { caps: CheckoutCaps };
const TRANSACTION_TIMEOUT_MS = 15_000;
const HOUR_MS = 3_600_000;

const EMPTY_CART = "Your cart is empty.";
const PAYMENT_SETUP_FAILED = "We couldn't start the payment. Please try again.";
const METHOD_UNAVAILABLE = "That payment method isn't available right now. Choose another one.";

type CheckedOutLine = PricedLine & {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
};

// ---------- Shipping quote ----------

export async function quoteShipping(db: DbClient, req: Request): Promise<ShippingOption[]> {
  const view = await cartView(db, await findCart(db, req));
  const settings = await loadSettings(db);
  return shippingOptions(
    view.totals.subtotalCents - view.totals.discountCents,
    shippingOf(settings),
  );
}

// ---------- Placing the order (one transaction) ----------

/** Cancels this cart's earlier unpaid checkouts (e.g. the shopper went back to change the address). */
async function supersedePending(tx: DbClient, cartId: string): Promise<(PaymentRef | null)[]> {
  const pending = await tx.order.findMany({
    where: { cartId, status: "PENDING_PAYMENT" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const refs: (PaymentRef | null)[] = [];
  // All order locks first, then variant locks (inside cancelPendingInTx): one lock order everywhere.
  for (const { id } of pending) await lockOrder(tx, id);
  for (const { id } of pending) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (order.status !== "PENDING_PAYMENT") continue;
    await cancelPendingInTx(tx, order, "superseded", "Replaced by a newer checkout.");
    refs.push(paymentRefOf(order));
  }
  return refs;
}

/** Locks the cart's variants and checks each line is still for sale and in stock. */
async function checkedOutLines(tx: DbClient, cartId: string): Promise<CheckedOutLine[]> {
  const items = await tx.cartItem.findMany({ where: { cartId }, orderBy: { createdAt: "asc" } });
  if (items.length === 0) throw new AppError("VALIDATION_ERROR", EMPTY_CART);

  const locked = await lockVariants(
    tx,
    items.map((i) => i.variantId),
  );
  const variants = await tx.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variantId) } },
    include: { product: { select: { name: true, status: true, categoryId: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  return items.map((item) => {
    const variant = byId.get(item.variantId);
    const stock = locked.get(item.variantId);
    if (!variant || !stock || !variant.isActive || variant.product.status !== "ACTIVE") {
      throw new AppError("CONFLICT", "An item in your cart is no longer available.", {
        variantId: item.variantId,
      });
    }
    const available = Math.max(0, stock.stockOnHand - stock.stockReserved);
    if (item.quantity > available) {
      throw new AppError("OUT_OF_STOCK", `Only ${available} left of ${variant.product.name}.`, {
        variantId: variant.id,
        available,
      });
    }
    return {
      variantId: variant.id,
      productName: variant.product.name,
      variantName: variant.name,
      sku: variant.sku,
      unitPriceCents: variant.priceCents,
      quantity: item.quantity,
      categoryId: variant.product.categoryId,
    };
  });
}

/** Re-checks the cart's coupon at the moment of purchase, including the per-customer limit by email. */
async function couponRule(
  tx: DbClient,
  cart: CartRow,
  lines: readonly PricedLine[],
  customer: { email: string; userId: string | null },
): Promise<CouponRule | undefined> {
  if (!cart.couponCode) return undefined;
  // Lock the coupon so concurrent checkouts can't all squeeze under its limits; open
  // (unpaid) checkouts count against the limits until they are paid or expire.
  await tx.$queryRaw`SELECT id FROM "Coupon" WHERE "code" = ${cart.couponCode} FOR UPDATE`;
  const found = await tx.coupon.findUnique({ where: { code: cart.couponCode } });
  const pending = await tx.order.count({
    where: { couponCode: cart.couponCode, status: "PENDING_PAYMENT" },
  });
  const coupon = found && { ...found, redemptions: found.redemptions + pending };
  const customerRedemptions = await tx.order.count({
    where: {
      couponCode: cart.couponCode,
      status: { notIn: ["CANCELLED"] },
      OR: [
        { email: { equals: customer.email, mode: "insensitive" } },
        ...(customer.userId ? [{ userId: customer.userId }] : []),
      ],
    },
  });
  const result = evaluateCoupon(coupon, {
    lines,
    currency: currencyOf(await loadSettings(tx)),
    now: new Date(),
    customerRedemptions,
    guest: customer.userId === null,
  });
  if (!result.ok) throw new AppError("COUPON_INVALID", result.message);
  return result.rule;
}

/** Totals from store settings: shipping rates and a flat VAT on (subtotal − discount). */
function priceOrder(
  lines: readonly PricedLine[],
  input: CheckoutInput,
  settings: SettingsRow,
  rule?: CouponRule,
): Totals {
  const goods = computeTotals(lines, 0, 0, rule);
  const rates = shippingOf(settings);
  const shipping = shippingCents(
    input.shippingMethod,
    goods.subtotalCents - goods.discountCents,
    rates,
  );
  return computeTotals(lines, shipping, settings.vatRateBps, rule);
}

async function nextOrderNumber(tx: DbClient, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "OrderSequence" ("year", "value") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "value" = "OrderSequence"."value" + 1
    RETURNING "value"`;
  if (!row) throw new Error("Order sequence returned no row");
  return formatOrderNumber(year, Number(row.value));
}

type PlaceOrderInput = {
  cart: CartRow;
  input: CheckoutInput;
  userId: string | null;
  idempotencyKey: string | null;
  requestHash: string;
  client: string;
  caps: CheckoutCaps;
  deps: CheckoutDeps;
};

/** The chosen method must be enabled, and a card provider must accept this currency and total. */
function assertMethodAvailable(placing: PlaceOrderInput, settings: SettingsRow, totals: Totals) {
  const { paymentMethod: method, manualMethodId } = placing.input;
  const enabled = availableMethods(settings, placing.deps.payments).includes(method);
  const providerOk =
    method !== "card" || placing.deps.payments.supports(currencyOf(settings), totals.totalCents);
  const manualOk = method !== "manual" || manualMethodFor(settings, manualMethodId) !== undefined;
  if (!enabled || !providerOk || !manualOk) {
    throw new AppError("PAYMENT_METHOD_UNAVAILABLE", METHOD_UNAVAILABLE);
  }
}

/** The enabled admin-defined method the shopper picked, if there is one. */
const manualMethodFor = (settings: SettingsRow, id: string | undefined) =>
  enabledManualMethods(settings).find((m) => m.id === id);

function paymentFields(input: CheckoutInput, settings: SettingsRow, provider: string, now: Date) {
  const transfer = input.paymentMethod === "bank_transfer";
  const manual = input.paymentMethod === "manual";
  const holdMs = transfer || manual ? settings.bankTransferHoldHours * HOUR_MS : reservationMs();
  const chosen = manual ? manualMethodFor(settings, input.manualMethodId) : undefined;
  return {
    currency: settings.currency,
    paymentMethod: toPaymentMethodRow(input.paymentMethod),
    paymentProvider: transfer || manual ? "manual" : provider,
    transferBank: transfer ? (bankOf(settings) ?? Prisma.JsonNull) : Prisma.JsonNull,
    // A snapshot: later edits to the method never change what this customer was told.
    manualPayment: chosen
      ? { id: chosen.id, label: chosen.label, instructions: chosen.instructions }
      : Prisma.JsonNull,
    reservationExpiresAt: new Date(now.getTime() + holdMs),
  };
}

async function placeOrder(tx: DbClient, placing: PlaceOrderInput) {
  const { cart, input, userId, idempotencyKey } = placing;
  const now = new Date();
  // Lock order everywhere: settings (shared), shopper advisory locks, orders, then variants.
  const settings = await lockSettings(tx, "share");
  const shopper = { userId, email: input.email, client: placing.client };
  await lockShopper(tx, shopper);
  const superseded = await supersedePending(tx, cart.id);
  await enforceOpenCheckoutCaps(tx, placing.caps, shopper, now);
  const lines = await checkedOutLines(tx, cart.id);
  const rule = await couponRule(tx, cart, lines, { email: input.email, userId });
  const totals = priceOrder(lines, input, settings, rule);
  assertMethodAvailable(placing, settings, totals);

  const order = await tx.order.create({
    data: {
      number: await nextOrderNumber(tx, now),
      idempotencyKey,
      idempotencyHash: idempotencyKey ? placing.requestHash : null,
      checkoutIpHash: placing.client,
      cartId: cart.id,
      userId,
      email: input.email,
      ...totals,
      ...paymentFields(input, settings, placing.deps.payments.provider, now),
      couponCode: rule ? cart.couponCode : null,
      shippingAddress: input.shippingAddress,
      shippingMethod: input.shippingMethod,
      items: {
        create: lines.map((l) => ({
          variantId: l.variantId,
          productName: l.productName,
          variantName: l.variantName,
          sku: l.sku,
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          lineTotalCents: l.unitPriceCents * l.quantity,
        })),
      },
      events: { create: { type: "created", toStatus: "PENDING_PAYMENT" } },
    },
    include: { items: true },
  });
  await tx.order.update({
    where: { id: order.id },
    data: { lookupTokenHash: lookupTokenHash(lookupTokenFor(order.id)) },
  });
  await reserve(tx, lines);
  return { order, totals, superseded };
}

// ---------- Public entry points ----------

const isIdempotencyCollision = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === "P2002" &&
  String((err.meta as { target?: unknown } | undefined)?.target ?? "").includes("idempotencyKey");

const totalsOf = (o: Totals): Totals => ({
  subtotalCents: o.subtotalCents,
  discountCents: o.discountCents,
  shippingCents: o.shippingCents,
  taxCents: o.taxCents,
  totalCents: o.totalCents,
});

/** The bank_transfer payment step for an order (bank details as snapshotted at checkout). */
function transferPayment(order: Order): CheckoutPayment {
  const details = bankTransferOf(order);
  if (!details) throw new AppError("CONFLICT", "This checkout is no longer awaiting payment.");
  return { kind: "bank_transfer", currency: currencyOf(order), ...details };
}

/** The payment step for an admin-defined method (label and instructions as snapshotted). */
function manualPayment(order: Order): CheckoutPayment {
  const details = manualPaymentOf(order);
  if (!details) throw new AppError("CONFLICT", "This checkout is no longer awaiting payment.");
  return { kind: "manual", currency: currencyOf(order), ...details };
}

function intentFor(order: Order, payment: CheckoutPayment): CheckoutIntent {
  return {
    orderNumber: order.number,
    lookupToken: lookupTokenFor(order.id),
    totals: totalsOf(order),
    currency: currencyOf(order),
    payment,
  };
}

/** Answers a retried request with the order the first attempt created. */
async function replay(
  deps: OrderDeps,
  idempotencyKey: string,
  requestHash: string,
): Promise<CheckoutIntent | null> {
  const order = await deps.db.order.findUnique({ where: { idempotencyKey } });
  if (!order) return null;
  // Orders from before Phase 3 have no stored hash; anything newer must match exactly.
  if (order.idempotencyHash !== null && order.idempotencyHash !== requestHash) {
    throw new AppError(
      "CONFLICT",
      "This Idempotency-Key was used for a different checkout. Start a new checkout.",
    );
  }
  if (order.status !== "PENDING_PAYMENT") {
    throw new AppError("CONFLICT", "This checkout has already been completed or cancelled.");
  }
  if (order.paymentMethod === "BANK_TRANSFER") return intentFor(order, transferPayment(order));
  if (order.paymentMethod === "MANUAL") return intentFor(order, manualPayment(order));
  const ref = paymentRefOf(order);
  if (!ref) {
    throw new AppError("CONFLICT", "This checkout is still being set up. Please try again.");
  }
  return intentFor(order, await deps.payments.resumePayment(ref));
}

/** If the provider can't create the payment, give the stock back straight away. */
async function abandonOrder(deps: OrderDeps, orderId: string) {
  await deps.db.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (order.status === "PENDING_PAYMENT") {
      await cancelPendingInTx(
        tx,
        order,
        "payment_setup_failed",
        "The payment could not be started.",
      );
      // Free the Idempotency-Key so the shopper's retry starts a fresh checkout instead of
      // replaying this cancelled one (which would answer 409 forever).
      await tx.order.update({ where: { id: orderId }, data: { idempotencyKey: null } });
    }
  });
}

type Placed = Awaited<ReturnType<typeof placeOrder>>;

/** Card: opens the payment at the provider and stores its references on the order. */
async function startCardPayment(deps: CheckoutDeps, placed: Placed, input: CheckoutInput) {
  const { order } = placed;
  try {
    const { ref, payment } = await deps.payments.createPayment({
      amountCents: order.totalCents,
      currency: currencyOf(order),
      orderId: order.id,
      orderNumber: order.number,
      email: order.email,
      customerName: input.shippingAddress.fullName,
      phone: input.shippingAddress.phone,
      returnUrl: `${env.WEB_ORIGIN}/checkout/return?number=${encodeURIComponent(order.number)}`,
      idempotencyKey: `intent:${order.id}`,
    });
    await deps.db.order.update({
      where: { id: order.id },
      data: { providerPaymentId: ref.paymentId, providerSessionId: ref.sessionId },
    });
    return intentFor(order, payment);
  } catch (err) {
    logger.error({ err: safeErrorFields(err), orderId: order.id }, "payment creation failed");
    capturePaymentError(err, { step: "create_payment" });
    await abandonOrder(deps, order.id);
    throw new AppError("PAYMENT_FAILED", PAYMENT_SETUP_FAILED);
  }
}

/** Bank transfer: no provider; the customer gets the bank details, amount, reference and deadline. */
async function startTransfer(deps: CheckoutDeps, placed: Placed): Promise<CheckoutIntent> {
  const payment = transferPayment(placed.order);
  if (payment.kind === "bank_transfer") {
    const mail = transferInstructionsEmail(placed.order, payment.bank, new Date(payment.dueAt));
    await sendFollowUpMail(deps, [mail]);
  }
  return intentFor(placed.order, payment);
}

/** Admin-defined method: no provider; the customer gets the admin's instructions, amount, reference and deadline. */
async function startManualPayment(deps: CheckoutDeps, placed: Placed): Promise<CheckoutIntent> {
  const payment = manualPayment(placed.order);
  if (payment.kind === "manual") {
    const mail = manualPaymentEmail(placed.order, payment, new Date(payment.dueAt));
    await sendFollowUpMail(deps, [mail]);
  }
  return intentFor(placed.order, payment);
}

async function placeWithReplay(
  deps: CheckoutDeps,
  placing: PlaceOrderInput,
): Promise<Placed | CheckoutIntent> {
  try {
    return await deps.db.$transaction((tx) => placeOrder(tx, placing), {
      timeout: TRANSACTION_TIMEOUT_MS,
    });
  } catch (err) {
    if (placing.idempotencyKey && isIdempotencyCollision(err)) {
      const previous = await replay(deps, placing.idempotencyKey, placing.requestHash);
      if (previous) return previous;
    }
    throw err;
  }
}

/**
 * Starts checkout: re-prices the cart on the server, reserves stock under row locks, creates
 * the order and either opens the card payment or returns bank-transfer instructions. Safe to
 * retry with the same Idempotency-Key.
 */
export async function createCheckoutIntent(
  deps: CheckoutDeps,
  req: Request,
  input: CheckoutInput,
  clientKey: string | undefined,
): Promise<CheckoutIntent> {
  const cart = await findCart(deps.db, req);
  if (!cart) throw new AppError("VALIDATION_ERROR", EMPTY_CART);
  // Scoped by cart so one shopper's key can never collide with (or reveal) another's order.
  const idempotencyKey = clientKey ? `${cart.id}:${clientKey}` : null;
  const requestHash = await checkoutFingerprint(deps.db, cart, input);
  if (idempotencyKey) {
    const previous = await replay(deps, idempotencyKey, requestHash);
    if (previous) return previous;
  }
  const placed = await placeWithReplay(deps, {
    cart,
    input,
    userId: req.user?.sub ?? null,
    idempotencyKey,
    requestHash,
    client: clientHash(req),
    caps: deps.caps,
    deps,
  });
  if ("orderNumber" in placed) return placed;
  for (const ref of placed.superseded) await cancelPaymentQuietly(deps.payments, ref);
  if (input.paymentMethod === "bank_transfer") return startTransfer(deps, placed);
  if (input.paymentMethod === "manual") return startManualPayment(deps, placed);
  return startCardPayment(deps, placed, input);
}
