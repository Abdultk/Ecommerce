-- Phase 3b: Oman store, store settings, card (Thawani/Stripe) and bank-transfer payments.
-- Hand-written from `prisma migrate diff`: columns are RENAMED (not dropped and re-added) so
-- existing payment and refund ids survive, and the raw-SQL search indexes are left alone.

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'BANK_TRANSFER');

-- Address: postal codes are optional in Oman.
ALTER TABLE "Address" ALTER COLUMN "postalCode" DROP NOT NULL;

-- Order: provider-neutral payment ids plus bank-transfer fields.
ALTER TABLE "Order" RENAME COLUMN "stripePaymentIntentId" TO "providerPaymentId";
ALTER INDEX "Order_stripePaymentIntentId_key" RENAME TO "Order_providerPaymentId_key";
ALTER TABLE "Order"
  ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CARD',
  ADD COLUMN "paymentProvider" TEXT,
  ADD COLUMN "providerSessionId" TEXT,
  ADD COLUMN "transferBank" JSONB,
  ADD COLUMN "transferBankReference" TEXT,
  ADD COLUMN "transferConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "transferConfirmedById" TEXT,
  ALTER COLUMN "currency" SET DEFAULT 'OMR';
-- Orders placed before this migration all paid by card through Stripe (or the fake provider).
UPDATE "Order" SET "paymentProvider" = 'stripe' WHERE "providerPaymentId" IS NOT NULL;
CREATE UNIQUE INDEX "Order_providerSessionId_key" ON "Order"("providerSessionId");
CREATE INDEX "Order_paymentMethod_status_idx" ON "Order"("paymentMethod", "status");

-- Refund: provider-neutral id, which provider, and the bank reference of manual refunds.
ALTER TABLE "Refund" RENAME COLUMN "stripeRefundId" TO "providerRefundId";
ALTER INDEX "Refund_stripeRefundId_key" RENAME TO "Refund_providerRefundId_key";
ALTER TABLE "Refund"
  ADD COLUMN "bankReference" TEXT,
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'stripe';

-- CreateTable: the store-settings singleton.
CREATE TABLE "StoreSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "storeName" TEXT NOT NULL DEFAULT 'Hearth & Pan',
    "currency" TEXT NOT NULL DEFAULT 'OMR',
    "vatRateBps" INTEGER NOT NULL DEFAULT 500,
    "standardCents" INTEGER NOT NULL DEFAULT 2000,
    "expressCents" INTEGER NOT NULL DEFAULT 5000,
    "freeShippingThresholdCents" INTEGER DEFAULT 30000,
    "standardDaysMin" INTEGER NOT NULL DEFAULT 2,
    "standardDaysMax" INTEGER NOT NULL DEFAULT 4,
    "expressDaysMin" INTEGER NOT NULL DEFAULT 1,
    "expressDaysMax" INTEGER NOT NULL DEFAULT 1,
    "cardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bankTransferEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bankTransferHoldHours" INTEGER NOT NULL DEFAULT 24,
    "bank" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StoreSettings_singleton" CHECK ("id" = 'default'),
    CONSTRAINT "StoreSettings_vat_range" CHECK ("vatRateBps" BETWEEN 0 AND 2500),
    CONSTRAINT "StoreSettings_hold_range" CHECK ("bankTransferHoldHours" BETWEEN 1 AND 168),
    CONSTRAINT "StoreSettings_one_method" CHECK ("cardEnabled" OR "bankTransferEnabled"),
    CONSTRAINT "StoreSettings_transfer_needs_bank" CHECK (NOT "bankTransferEnabled" OR "bank" IS NOT NULL)
);

-- The Oman defaults (OMR; amounts in baisa). Bank transfer stays off until bank details exist.
INSERT INTO "StoreSettings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP);
