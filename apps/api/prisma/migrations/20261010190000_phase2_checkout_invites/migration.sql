-- Phase 2: staff invites, checkout idempotency, hard session-family expiry.
-- Hand-edited: Prisma's diff also proposes dropping the search indexes created by raw SQL
-- in the init migration (it cannot model them). Those drops are intentionally omitted.

-- AlterEnum
ALTER TYPE "UserTokenType" ADD VALUE 'ADMIN_INVITE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "cartId" TEXT,
ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- AlterTable: backfill existing sessions with their current expiry, then require the column.
ALTER TABLE "RefreshToken" ADD COLUMN "familyExpiresAt" TIMESTAMP(3);
UPDATE "RefreshToken" SET "familyExpiresAt" = "expiresAt" WHERE "familyExpiresAt" IS NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "familyExpiresAt" SET NOT NULL;
