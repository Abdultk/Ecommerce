-- DropIndex
DROP INDEX "Product_name_trgm_idx";

-- DropIndex
DROP INDEX "Product_searchVector_idx";

-- CreateTable
CREATE TABLE "CustomerPreferences" (
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "marketingEmails" BOOLEAN NOT NULL DEFAULT false,
    "shippingUpdateEmails" BOOLEAN NOT NULL DEFAULT true,
    "preferredPayment" "PaymentMethod",
    "preferredShipping" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPreferences_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "CustomerPreferences" ADD CONSTRAINT "CustomerPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
