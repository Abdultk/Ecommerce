/**
 * Imports the Al Baleed product photos as catalog products.
 *
 *   tsx --env-file=../../.env scripts/import-albaleed.ts            dry run: prints the plan
 *   tsx --env-file=../../.env scripts/import-albaleed.ts --apply    creates categories + products
 *   tsx --env-file=../../.env scripts/import-albaleed.ts --prices scripts/albaleed/prices.csv [--apply]
 *                                                                   applies real prices and stock
 *
 * Photos are shrunk to web-size WebP and stored the way admin uploads are: in R2 when
 * IMAGE_STORAGE=r2, otherwise in apps/api/.dev-cdn (served at /dev-cdn in development).
 * Products are created as DRAFT with an inactive placeholder variant: the photos do not tell
 * us prices, stock or materials, so nothing can be sold until --prices supplies real values.
 * Safe to re-run: products that already exist (by SKU) are skipped. Every change writes the
 * same audit entry the admin console would.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import type { AdminProductInput } from "@hp/contracts";
import { env } from "../src/config/env";
import { prisma, type DbClient } from "../src/lib/prisma";
import { createFakeStorage, createR2Storage, type ImageStorage } from "../src/lib/storage";
import { createAdminProduct } from "../src/modules/admin/products.admin.service";
import { CATEGORIES, NOT_PRODUCTS, PRODUCTS, type ProductSeed } from "./albaleed/catalog";

const PHOTO_DIR = path.resolve(process.cwd(), "../../albaleed images");
const DEV_CDN_DIR = path.resolve(process.cwd(), ".dev-cdn");
const DEFAULT_PRICES_CSV = path.resolve(process.cwd(), "scripts/albaleed/prices.csv");
const MAX_EDGE_PX = 1600;
const WEBP_QUALITY = 82;
const PLACEHOLDER_PRICE_BAISA = 1;
const BAISA_PER_OMR = 1000;
const SOURCE = "albaleed-import";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const pricesFlag = args.indexOf("--prices");
const pricesFile = pricesFlag >= 0 ? path.resolve(args[pricesFlag + 1] ?? DEFAULT_PRICES_CSV) : null;

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const slugOf = (p: ProductSeed) =>
  `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${p.code.toLowerCase()}`;
const skuOf = (code: string) => `PAI-${code}`;

function storageFromEnv(): {
  storage: ImageStorage;
  put: (key: string, body: Buffer) => Promise<void>;
} {
  if (env.IMAGE_STORAGE === "r2") {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    return {
      storage: createR2Storage({
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: env.R2_BUCKET!,
        cdnBaseUrl: env.CDN_BASE_URL,
      }),
      put: async (key, body) => {
        await client.send(
          new PutObjectCommand({
            Bucket: env.R2_BUCKET!,
            Key: key,
            Body: body,
            ContentType: "image/webp",
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
      },
    };
  }
  return {
    storage: createFakeStorage(env.CDN_BASE_URL),
    put: async (key, body) => {
      const target = path.join(DEV_CDN_DIR, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    },
  };
}

/** The photo files that belong to one product, without byte-identical duplicates. */
function photosOf(product: ProductSeed, all: string[]): string[] {
  const wanted =
    product.files ??
    all.filter((f) => {
      const stem = f.replace(/\.png$/i, "");
      return stem === product.code || stem.startsWith(`${product.code} (`);
    });
  const seen = new Set<string>();
  return wanted.filter((f) => {
    const hash = createHash("sha256")
      .update(fs.readFileSync(path.join(PHOTO_DIR, f)))
      .digest("hex");
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

function assignPhotos(allFiles: string[]) {
  const byCode = new Map(PRODUCTS.map((p) => [p.code, photosOf(p, allFiles)] as const));
  const used = new Set([...byCode.values()].flat());
  const unassigned = allFiles.filter((f) => !used.has(f) && !NOT_PRODUCTS.includes(f));
  return { byCode, unassigned };
}

async function superAdminId(): Promise<string> {
  const actor = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (!actor) throw new Error("No SUPER_ADMIN user to record the change against.");
  return actor.id;
}

async function ensureCategories(actorId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [position, c] of CATEGORIES.entries()) {
    const found = await prisma.category.findUnique({ where: { slug: c.slug } });
    if (found) {
      ids.set(c.slug, found.id);
      continue;
    }
    const created = await prisma.category.create({
      data: { slug: c.slug, name: c.name, translations: { ar: { name: c.ar } }, position },
    });
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "category.create",
        entity: "Category",
        entityId: created.id,
        after: { slug: c.slug, source: SOURCE },
      },
    });
    ids.set(c.slug, created.id);
  }
  return ids;
}

async function toWebp(file: string): Promise<Buffer> {
  return sharp(path.join(PHOTO_DIR, file))
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

function draftInput(
  p: ProductSeed,
  categoryId: string,
  images: AdminProductInput["images"],
): AdminProductInput {
  return {
    name: p.name,
    slug: slugOf(p),
    brand: null,
    categoryId,
    description: `<p>${p.name}.</p>`,
    material: null,
    careInstructions: null,
    dishwasherSafe: null,
    inductionCompatible: null,
    ovenSafeToF: null,
    status: "DRAFT",
    images,
    variants: [
      {
        sku: skuOf(p.code),
        name: "Standard",
        priceCents: PLACEHOLDER_PRICE_BAISA,
        compareAtPriceCents: null,
        costCents: null,
        initialStock: 0,
        lowStockThreshold: 5,
        weightGrams: null,
        attributes: {},
        isActive: false,
      },
    ],
  };
}

async function importCatalog() {
  const allFiles = fs
    .readdirSync(PHOTO_DIR)
    .filter((f) => /\.png$/i.test(f))
    .sort(naturalSort);
  const { byCode, unassigned } = assignPhotos(allFiles);
  const existing = new Set(
    (await prisma.productVariant.findMany({ select: { sku: true } })).map((v) => v.sku),
  );
  const todo = PRODUCTS.filter((p) => !existing.has(skuOf(p.code)));
  console.log(`${allFiles.length} photos, ${PRODUCTS.length} products, ${todo.length} to create`);
  console.log(`Logos skipped: ${NOT_PRODUCTS.join(", ")}`);
  if (unassigned.length) console.log(`Photos not matched to any product: ${unassigned.join(", ")}`);
  const noPhotos = PRODUCTS.filter((p) => (byCode.get(p.code) ?? []).length === 0);
  if (noPhotos.length) throw new Error(`No photos for: ${noPhotos.map((p) => p.code).join(", ")}`);
  if (!apply) {
    for (const p of todo) {
      const n = (byCode.get(p.code) ?? []).length;
      console.log(`  ${p.code.padEnd(4)} ${p.category.padEnd(16)} ${n} photo(s)  ${p.name}`);
    }
    console.log("\nDry run. Add --apply to write.");
    return;
  }

  const actorId = await superAdminId();
  const { storage, put } = storageFromEnv();
  const categoryIds = await ensureCategories(actorId);
  const year = new Date().getUTCFullYear();

  for (const p of todo) {
    const images: AdminProductInput["images"] = [];
    for (const [i, file] of (byCode.get(p.code) ?? []).entries()) {
      const key = `products/${year}/${randomUUID()}.webp`;
      await put(key, await toWebp(file));
      images.push({ key, alt: `${p.name}, photo ${i + 1}`, position: i });
    }
    const input = draftInput(p, categoryIds.get(p.category)!, images);
    await prisma.$transaction(async (tx) => {
      const created = await createAdminProduct(tx as DbClient, storage, input, actorId);
      await tx.product.update({
        where: { id: created.id },
        data: { translations: { ar: { name: p.ar, description: `<p>${p.ar}.</p>` } } },
      });
      await tx.productVariant.updateMany({
        where: { productId: created.id },
        data: { translations: { ar: { name: "قياسي" } } },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "product.create",
          entity: "Product",
          entityId: created.id,
          after: {
            slug: input.slug,
            name: input.name,
            status: "DRAFT",
            images: images.length,
            source: SOURCE,
          },
        },
      });
    });
    console.log(`created ${p.code.padEnd(4)} ${p.name} (${images.length} photos)`);
  }
  writePricesTemplate();
}

function writePricesTemplate() {
  if (fs.existsSync(DEFAULT_PRICES_CSV)) return;
  const rows = PRODUCTS.map((p) => `${p.code},"${p.name.replace(/"/g, '""')}",,`);
  fs.writeFileSync(DEFAULT_PRICES_CSV, ["code,name,price_omr,stock", ...rows].join("\n") + "\n");
  console.log(`Wrote ${DEFAULT_PRICES_CSV}: fill price_omr (e.g. 12.500) and stock, then --prices.`);
}

/** Applies real prices and stock; a product goes live only when it has a price and a photo. */
async function applyPrices(file: string) {
  const actorId = await superAdminId();
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
  let changed = 0;
  for (const line of lines) {
    const cells = line.split(",");
    const code = cells[0]!.trim();
    const priceText = cells.at(-2)?.trim() ?? "";
    const stockText = cells.at(-1)?.trim() ?? "";
    if (!priceText || !stockText) continue;
    const priceBaisa = Math.round(Number(priceText) * BAISA_PER_OMR);
    const stock = Number(stockText);
    if (!Number.isFinite(priceBaisa) || priceBaisa <= 0 || !Number.isInteger(stock) || stock < 0) {
      throw new Error(`${code}: price "${priceText}" / stock "${stockText}" is not valid`);
    }
    const variant = await prisma.productVariant.findUnique({
      where: { sku: skuOf(code) },
      include: { product: { include: { images: { select: { id: true } } } } },
    });
    if (!variant) throw new Error(`${code}: no product with SKU ${skuOf(code)}`);
    if (!apply) {
      const omr = (priceBaisa / BAISA_PER_OMR).toFixed(3);
      console.log(`would set ${code}: ${omr} OMR, stock ${stock}, publish`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { priceCents: priceBaisa, isActive: true, stockOnHand: stock },
      });
      const delta = stock - variant.stockOnHand;
      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            variantId: variant.id,
            delta,
            reason: "RESTOCK",
            note: "Initial stock (Al Baleed import)",
            actorId,
          },
        });
      }
      const live = variant.product.images.length > 0;
      if (live) {
        await tx.product.update({ where: { id: variant.productId }, data: { status: "ACTIVE" } });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: "product.update",
          entity: "Product",
          entityId: variant.productId,
          before: {
            priceCents: variant.priceCents,
            stockOnHand: variant.stockOnHand,
            status: variant.product.status,
          },
          after: {
            priceCents: priceBaisa,
            stockOnHand: stock,
            status: live ? "ACTIVE" : variant.product.status,
            source: SOURCE,
          },
        },
      });
    });
    changed += 1;
  }
  console.log(apply ? `Updated ${changed} product(s).` : "Dry run. Add --apply to write.");
}

try {
  if (pricesFile) await applyPrices(pricesFile);
  else await importCatalog();
} finally {
  await prisma.$disconnect();
}
