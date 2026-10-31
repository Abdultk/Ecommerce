import { PrismaClient } from "@prisma/client";
import { applyArabicCatalog } from "./catalog-ar";

// Usage: pnpm --filter @hp/api exec tsx --env-file=../../.env prisma/apply-catalog-ar.ts
const db = new PrismaClient();
applyArabicCatalog(db)
  .then((n) => console.warn("Arabic catalog applied:", n))
  .finally(() => db.$disconnect());
