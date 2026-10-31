-- Localised catalog text. Base columns stay English; other languages live under their code.
ALTER TABLE "Category" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Product" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ProductVariant" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';
