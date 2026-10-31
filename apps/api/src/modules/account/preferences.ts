import type { CustomerPreferences as PreferencesRow } from "@prisma/client";
import type { CustomerPreferences, ShippingMethod } from "@hp/contracts";
import type { DbClient } from "../../lib/prisma";

/** What a customer who never saved settings gets: receipts yes, offers no, no checkout defaults. */
export const DEFAULT_PREFERENCES: CustomerPreferences = Object.freeze({
  phone: null,
  marketingEmails: false,
  shippingUpdateEmails: true,
  preferredPayment: null,
  preferredShipping: null,
  updatedAt: null,
});

const PAYMENT_OUT = { CARD: "card", BANK_TRANSFER: "bank_transfer", MANUAL: "manual" } as const;
export const PAYMENT_IN = { card: "CARD", bank_transfer: "BANK_TRANSFER", manual: "MANUAL" } as const;

export function toPreferences(row: PreferencesRow | null): CustomerPreferences {
  if (!row) return DEFAULT_PREFERENCES;
  return {
    phone: row.phone,
    marketingEmails: row.marketingEmails,
    shippingUpdateEmails: row.shippingUpdateEmails,
    preferredPayment: row.preferredPayment ? PAYMENT_OUT[row.preferredPayment] : null,
    preferredShipping: (row.preferredShipping as ShippingMethod | null) ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Whether to send the "your order has shipped" email: always for guests and for new accounts. */
export async function wantsShippingEmail(db: DbClient, userId: string | null): Promise<boolean> {
  if (!userId) return true;
  const row = await db.customerPreferences.findUnique({
    where: { userId },
    select: { shippingUpdateEmails: true },
  });
  return row?.shippingUpdateEmails ?? true;
}

/** "Chrome on Windows" from a User-Agent string; never more precise than that. */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iOS/.test(userAgent)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return system ? `${browser} on ${system}` : browser;
}
