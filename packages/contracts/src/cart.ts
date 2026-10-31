import { z } from "zod";
import { Cents, CouponCode, HttpUrl, Id, Sku, Slug, Totals } from "./common";
import { CurrencyCode } from "./money";

export const MAX_LINE_QUANTITY = 99;
/** Distinct variants one cart can hold; adding another fails with VALIDATION_ERROR. */
export const MAX_CART_LINES = 50;

const Quantity = z
  .number()
  .int()
  .min(1)
  .max(MAX_LINE_QUANTITY, `You can add up to ${MAX_LINE_QUANTITY}.`);

export const AddCartItemInput = z.object({ variantId: Id, quantity: Quantity });
export type AddCartItemInput = z.infer<typeof AddCartItemInput>;

export const UpdateCartItemInput = z.object({ quantity: Quantity });
export type UpdateCartItemInput = z.infer<typeof UpdateCartItemInput>;

export const ApplyCouponInput = z.object({ code: CouponCode });
export type ApplyCouponInput = z.infer<typeof ApplyCouponInput>;

export const CartLine = z
  .object({
    id: Id,
    variantId: Id,
    productSlug: Slug,
    productName: z.string(),
    variantName: z.string(),
    sku: Sku,
    thumbnailUrl: HttpUrl.nullable(),
    unitPriceCents: Cents,
    quantity: Quantity,
    lineTotalCents: Cents,
    stockAvailable: Cents,
  })
  .refine((l) => l.lineTotalCents === l.unitPriceCents * l.quantity, {
    path: ["lineTotalCents"],
    message: "Line total must equal unit price × quantity.",
  });
export type CartLine = z.infer<typeof CartLine>;

/** Totals are always computed by the server; clients only display them. */
export const Cart = z
  .object({
    id: Id,
    items: z.array(CartLine),
    couponCode: z.string().nullable(),
    totals: Totals,
    /** Store currency; every amount in the cart is in its minor units. */
    currency: CurrencyCode,
  })
  .refine((c) => c.totals.subtotalCents === c.items.reduce((sum, l) => sum + l.lineTotalCents, 0), {
    path: ["totals", "subtotalCents"],
    message: "Subtotal must equal the sum of the lines.",
  });
export type Cart = z.infer<typeof Cart>;
