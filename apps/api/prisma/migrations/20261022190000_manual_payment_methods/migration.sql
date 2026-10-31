-- Admin-defined offline payment methods.
ALTER TYPE "PaymentMethod" ADD VALUE 'MANUAL';

ALTER TABLE "StoreSettings" ADD COLUMN "manualMethods" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "Order" ADD COLUMN "manualPayment" JSONB;
