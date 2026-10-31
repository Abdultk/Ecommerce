-- Phase 3: report export jobs, admin idempotency records, checkout fingerprints and caps,
-- low-stock alert dedupe. Hand-edited: Prisma's diff also proposes dropping the search
-- indexes created by raw SQL in the init migration (it cannot model them); omitted.

-- CreateEnum
CREATE TYPE "ReportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutIpHash" TEXT,
ADD COLUMN     "idempotencyHash" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "lowStockAlertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportJob" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "rangeFrom" TIMESTAMP(3) NOT NULL,
    "rangeTo" TIMESTAMP(3) NOT NULL,
    "status" "ReportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "storageKey" TEXT,
    "rowCount" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

-- CreateIndex
CREATE INDEX "ReportJob_requestedById_createdAt_idx" ON "ReportJob"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "ReportJob_createdAt_idx" ON "ReportJob"("createdAt");

-- AddForeignKey
ALTER TABLE "ReportJob" ADD CONSTRAINT "ReportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- Hand-written: partial indexes for the open-checkout caps (Prisma cannot model these).
CREATE INDEX "Order_pending_email_idx" ON "Order" (lower("email")) WHERE "status" = 'PENDING_PAYMENT';
CREATE INDEX "Order_pending_ip_idx" ON "Order" ("checkoutIpHash") WHERE "status" = 'PENDING_PAYMENT';
