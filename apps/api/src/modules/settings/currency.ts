import { Prisma, type StoreSettings as SettingsRow } from "@prisma/client";
import { MAX_CENTS, currencyExponent, rescaleMinor, type CurrencyCode } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import type { DbClient } from "../../lib/prisma";
import { SETTINGS_ID, currencyOf } from "./settings.service";

/**
 * SQL that rescales an integer money column by 10^delta. Shrinking rounds half away from
 * zero (Postgres ROUND on numeric), matching rescaleMinor for the non-negative amounts we store.
 */
function scaled(column: string, delta: number, floor: number | null = null): Prisma.Sql {
  const col = Prisma.raw(`"${column}"`);
  const factor = 10 ** Math.abs(delta);
  const expr =
    delta >= 0
      ? Prisma.sql`${col} * ${factor}`
      : Prisma.sql`ROUND(${col}::numeric / ${factor})::int`;
  return floor === null ? expr : Prisma.sql`GREATEST(${floor}, ${expr})`;
}

/** Refuses a switch that would push any stored amount past the per-amount cap. */
async function assertFits(tx: DbClient, delta: number): Promise<void> {
  if (delta <= 0) return;
  const [row] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT GREATEST(
      (SELECT MAX(GREATEST("priceCents", COALESCE("compareAtPriceCents", 0), COALESCE("costCents", 0))) FROM "ProductVariant"),
      (SELECT MAX(GREATEST("value", "minSubtotalCents")) FROM "Coupon")
    )::int AS max`;
  if ((row?.max ?? 0) * 10 ** delta > MAX_CENTS) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Some prices would be too large in the new currency. Lower them first.",
    );
  }
}

async function rescaleCatalog(tx: DbClient, delta: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ProductVariant" SET
      "priceCents" = ${scaled("priceCents", delta, 1)},
      "compareAtPriceCents" = ${scaled("compareAtPriceCents", delta)},
      "costCents" = ${scaled("costCents", delta)}`;
  // Rounding can squeeze a compare-at price down to the price; it must stay higher.
  await tx.$executeRaw`
    UPDATE "ProductVariant" SET "compareAtPriceCents" = NULL
    WHERE "compareAtPriceCents" IS NOT NULL AND "compareAtPriceCents" <= "priceCents"`;
  await tx.$executeRaw`
    UPDATE "Coupon" SET "value" = ${scaled("value", delta, 1)} WHERE "type" = 'FIXED'`;
  await tx.$executeRaw`UPDATE "Coupon" SET "minSubtotalCents" = ${scaled("minSubtotalCents", delta)}`;
}

/**
 * Switches the store currency inside the caller's transaction, which must already hold the
 * settings row lock. Refused once any order exists (orders keep the currency they were placed
 * in, and reports would mix scales). Every stored amount is rescaled so 18.500 OMR becomes
 * 18.50 USD: the number of major units stays the same; no exchange rate is applied.
 */
export async function switchCurrency(
  tx: DbClient,
  settings: SettingsRow,
  to: CurrencyCode,
): Promise<void> {
  if ((await tx.order.count()) > 0) {
    throw new AppError(
      "CURRENCY_LOCKED",
      "The currency can't be changed once the store has orders.",
    );
  }
  const from = currencyOf(settings);
  const delta = currencyExponent(to) - currencyExponent(from);
  await assertFits(tx, delta);
  if (delta !== 0) await rescaleCatalog(tx, delta);
  const rescale = (n: number) => rescaleMinor(n, from, to);
  await tx.storeSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      currency: to,
      standardCents: rescale(settings.standardCents),
      expressCents: rescale(settings.expressCents),
      freeShippingThresholdCents:
        settings.freeShippingThresholdCents === null
          ? null
          : rescale(settings.freeShippingThresholdCents),
    },
  });
}
