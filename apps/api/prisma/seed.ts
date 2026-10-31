import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { makeCategoryTree, sampleCatalog } from "@hp/test-utils";
import { createAdminInvite, inviteLink } from "../src/modules/auth/invites";
import { applyArabicCatalog } from "./catalog-ar";
import { seedDemoCatalog } from "./demo-catalog";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Demo prices in Omani rials, as baisa (1 OMR = 1000 baisa), by SKU. The shared sample
 * catalog (used by the storefront and admin mocks) keeps its own numbers; the database gets
 * these. Unknown SKUs keep the sample number.
 */
export const OMR_PRICES: Readonly<Record<string, { price: number; compareAt?: number }>> = {
  "IV-SK10": { price: 18_500 },
  "IV-SK12": { price: 23_500 },
  "NF-DO55-COB": { price: 84_000, compareAt: 99_000 },
  "NF-DO55-SAG": { price: 84_000 },
  "CL-SP2": { price: 27_000 },
  "BR-CK8": { price: 34_500 },
  "NF-CB-M": { price: 30_500 },
  "NF-CB-L": { price: 42_000 },
  "BR-SP3": { price: 5_800 },
  "CL-GS10": { price: 15_500 },
  "IV-KS5": { price: 9_600 },
};

/**
 * Store settings: OMR, 5% VAT, Oman shipping, card payments only. Bank details and any other
 * payment method are the admin's to add under Settings → Payments, so nothing is invented here.
 * Leaves an already-configured store alone.
 */
export async function seedStoreSettings(db: Db): Promise<void> {
  await db.storeSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

/** Upserts the demo category tree (positions follow the listed order). Idempotent. */
export async function seedCategories(db: Db): Promise<void> {
  const tree = makeCategoryTree();
  for (const [i, top] of tree.entries()) {
    const parent = await db.category.upsert({
      where: { slug: top.slug },
      create: { slug: top.slug, name: top.name, position: i },
      update: { name: top.name, position: i, parentId: null },
    });
    for (const [j, child] of top.children.entries()) {
      await db.category.upsert({
        where: { slug: child.slug },
        create: { slug: child.slug, name: child.name, position: j, parentId: parent.id },
        update: { name: child.name, position: j, parentId: parent.id },
      });
    }
  }
}

/**
 * Inserts the 8-product sample kitchen catalog. Existing products (by slug) are left
 * untouched; new variants get a RESTOCK movement so the stock ledger sums correctly.
 */
export async function seedCatalog(db: Db): Promise<void> {
  await seedCategories(db);
  for (const product of sampleCatalog()) {
    if (await db.product.findUnique({ where: { slug: product.slug } })) continue;
    const category = await db.category.findUniqueOrThrow({ where: { slug: product.categorySlug } });
    await db.product.create({
      data: {
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        description: product.description,
        material: product.material,
        careInstructions: product.careInstructions,
        dishwasherSafe: product.dishwasherSafe,
        inductionCompatible: product.inductionCompatible,
        ovenSafeToF: product.ovenSafeToF,
        status: "ACTIVE",
        categoryId: category.id,
        ratingAvg: product.ratingAvg,
        ratingCount: product.ratingCount,
        images: {
          create: product.images.map((img) => ({
            key: `products/seed/${product.slug}.webp`,
            url: img.url,
            alt: img.alt,
            position: img.position,
          })),
        },
        variants: {
          create: product.variants.map((v) => ({
            sku: v.sku,
            name: v.name,
            attributes: v.attributes,
            priceCents: OMR_PRICES[v.sku]?.price ?? v.priceCents,
            compareAtPriceCents: OMR_PRICES[v.sku]
              ? (OMR_PRICES[v.sku]!.compareAt ?? null)
              : v.compareAtPriceCents,
            stockOnHand: v.stockAvailable,
            movements:
              v.stockAvailable > 0
                ? { create: { delta: v.stockAvailable, reason: "RESTOCK", note: "Seed stock" } }
                : undefined,
          })),
        },
      },
    });
  }
}

/**
 * Puts the OMR prices on sample variants seeded before OMR_PRICES existed (seedCatalog
 * skips products that are already there, so they would keep their old numbers). Idempotent.
 */
export async function seedSamplePrices(db: Db): Promise<void> {
  for (const [sku, { price, compareAt }] of Object.entries(OMR_PRICES)) {
    await db.productVariant.updateMany({
      where: { sku },
      data: { priceCents: price, compareAtPriceCents: compareAt ?? null },
    });
  }
}

export async function seedCoupons(db: Db): Promise<void> {
  await db.coupon.upsert({
    where: { code: "WELCOME10" },
    create: { code: "WELCOME10", type: "PERCENT", value: 10, minSubtotalCents: 5_000 },
    update: {},
  });
}

/** Creates the first SUPER_ADMIN if the email isn't taken. 2FA enrollment happens at first sign-in. */
/**
 * Ensures a SUPER_ADMIN exists. Staff set their own password and 2FA through an invite,
 * so no password is ever seeded: returns an invite token while the admin hasn't enrolled.
 */
export async function seedAdmin(db: Db, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email: normalized } });
  if (existing?.totpEnabledAt) return null;
  const admin =
    existing ??
    (await db.user.create({
      data: {
        email: normalized,
        // Unusable until the invite is accepted.
        passwordHash: await argon2.hash(randomBytes(32).toString("hex"), { type: argon2.argon2id }),
        firstName: "Store",
        lastName: "Admin",
        role: "SUPER_ADMIN",
        emailVerifiedAt: new Date(),
      },
    }));
  return createAdminInvite(db, admin.id);
}

async function main() {
  const db = new PrismaClient();
  try {
    const demoAllowed =
      process.env.NODE_ENV !== "production" || process.env.SEED_DEMO_CATALOG === "true";
    // The demo kitchenware catalog is opt-in: the shop sells the Al Baleed products
    // (scripts/import-albaleed.ts), so a plain seed never adds demo products or categories.
    if (demoAllowed && process.env.SEED_DEMO_CATALOG === "true") {
      await seedCatalog(db);
      await seedSamplePrices(db);
      await seedDemoCatalog(db);
      await applyArabicCatalog(db);
      console.warn("Seeded the demo catalog (OMR).");
    }
    if (demoAllowed) {
      await seedCoupons(db);
      await seedStoreSettings(db);
      console.warn("Seeded the WELCOME10 coupon and store settings.");
    }
    const { SEED_ADMIN_EMAIL } = process.env;
    if (SEED_ADMIN_EMAIL) {
      const token = await seedAdmin(db, SEED_ADMIN_EMAIL);
      console.warn(
        token
          ? `SUPER_ADMIN ${SEED_ADMIN_EMAIL}: finish setup within 72 hours at
${inviteLink(token)}`
          : `SUPER_ADMIN ${SEED_ADMIN_EMAIL} is already set up.`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}

// Run only when executed directly (prisma db seed), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
