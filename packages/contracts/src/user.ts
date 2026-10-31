import { z } from "zod";
import { Id, IsoDateTime, PersonName } from "./common";
import { OmanPhone, ShippingAddress, ShippingMethod, StoredAddress } from "./orders";
import { PaymentMethod } from "./settings";

export const ProfileUpdate = z
  .object({ firstName: PersonName.optional(), lastName: PersonName.optional() })
  .strict()
  .refine(
    (p) => p.firstName !== undefined || p.lastName !== undefined,
    "Change at least one field.",
  );
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const AddressInput = ShippingAddress.extend({ isDefault: z.boolean().default(false) });
export type AddressInput = z.infer<typeof AddressInput>;

/** Read model: lenient, so addresses saved before the Oman switch still load. */
export const Address = StoredAddress.extend({ id: Id, isDefault: z.boolean() });
export type Address = z.infer<typeof Address>;

export const WishlistItem = z.object({ productId: Id, addedAt: IsoDateTime });
export type WishlistItem = z.infer<typeof WishlistItem>;

// ---------- Customer preferences ----------

/**
 * GET/PUT /me/preferences. Everything here is honoured by the shop: the phone and the two
 * checkout defaults prefill checkout, shippingUpdateEmails switches the "your order has
 * shipped" email, and marketingEmails is a consent that is off until the customer turns it on.
 * Receipts and payment emails are never optional.
 */
export const CustomerPreferences = z.object({
  /** Stored in the +968 form, or null. */
  phone: z.string().nullable(),
  marketingEmails: z.boolean(),
  shippingUpdateEmails: z.boolean(),
  preferredPayment: PaymentMethod.nullable(),
  preferredShipping: ShippingMethod.nullable(),
  updatedAt: IsoDateTime.nullable(),
});
export type CustomerPreferences = z.infer<typeof CustomerPreferences>;

/** Only the fields sent change. An empty phone, or null, clears it. */
export const CustomerPreferencesUpdate = z
  .object({
    phone: z.union([z.null(), z.literal("").transform(() => null), OmanPhone]).optional(),
    marketingEmails: z.boolean().optional(),
    shippingUpdateEmails: z.boolean().optional(),
    preferredPayment: PaymentMethod.nullable().optional(),
    preferredShipping: ShippingMethod.nullable().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), "Change at least one setting.");
export type CustomerPreferencesUpdate = z.infer<typeof CustomerPreferencesUpdate>;
