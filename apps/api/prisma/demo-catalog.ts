import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The demo shop's photographed range. Every product here has a real, open-licensed photo
 * (served from apps/web/public/products, credited on the storefront's /credits page), and a
 * product that has no photo of the right item is not in this list. Prices are OMR baisa.
 */

type DemoVariant = { sku: string; name: string; price: number; stock: number; size?: string };
type DemoProduct = {
  slug: string;
  name: string;
  category: string;
  alt: string;
  description: string;
  material: string;
  care: string;
  dishwasherSafe?: boolean;
  inductionCompatible?: boolean;
  ovenSafeToF?: number;
  variants: DemoVariant[];
};

/** [parent slug, slug, name]: sub-collections the sample tree lacks. */
export const DEMO_CATEGORIES: ReadonlyArray<readonly [string, string, string]> = [
  ["cookware", "stockpots", "Stockpots & Pasta Pots"],
  ["knives-cutlery", "paring-knives", "Paring Knives"],
  ["knives-cutlery", "bread-knives", "Bread Knives"],
  ["knives-cutlery", "knife-storage", "Knife Storage"],
  ["utensils-tools", "mortars", "Mortars & Pestles"],
  ["utensils-tools", "rolling-pins", "Rolling Pins"],
  ["utensils-tools", "strainers-graters", "Strainers & Graters"],
  ["utensils-tools", "spoons", "Cooking Spoons"],
  ["small-appliances", "kettles-brewing", "Kettles & Brewing"],
];

const one = (sku: string, price: number, stock: number): DemoVariant[] => [
  { sku, name: "Standard", price, stock },
];

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    slug: "copper-saucepan",
    name: "Copper Saucepan",
    category: "saucepans",
    alt: "Copper saucepan with a long handle on a gas hob",
    description:
      "<p>A copper saucepan that answers quickly to the flame, for sauces, custards and reductions where you want to adjust the heat and see it work.</p>",
    material: "Copper with a stainless steel lining",
    care: "Hand wash. Polish the copper occasionally if you like it bright.",
    dishwasherSafe: false,
    inductionCompatible: false,
    variants: one("HP-CU-SP", 46_000, 14),
  },
  {
    slug: "pasta-pot-with-strainer",
    name: "Pasta Pot with Strainer Insert",
    category: "stockpots",
    alt: "Stainless steel pasta pot with a perforated strainer insert",
    description:
      "<p>A tall stainless pot with a perforated insert: lift the insert and the pasta drains without a colander.</p>",
    material: "Stainless steel",
    care: "Dishwasher safe.",
    dishwasherSafe: true,
    inductionCompatible: true,
    variants: one("HP-PP-ST", 32_000, 20),
  },
  {
    slug: "stainless-colander",
    name: "Stainless Steel Colander",
    category: "strainers-graters",
    alt: "Stainless steel colander with two handles",
    description: "<p>A steel colander with two handles, for rinsing and draining.</p>",
    material: "Stainless steel",
    care: "Dishwasher safe.",
    dishwasherSafe: true,
    variants: one("HP-CO-ST", 6_500, 35),
  },
  {
    slug: "box-grater",
    name: "Four-Sided Box Grater",
    category: "strainers-graters",
    alt: "Stainless steel four-sided box grater with a red handle",
    description: "<p>Four grating faces on one stand-up grater, from coarse shreds to fine zest.</p>",
    material: "Stainless steel with a plastic handle",
    care: "Hand wash to keep the edges sharp.",
    dishwasherSafe: false,
    variants: one("HP-BG-4", 4_800, 40),
  },
  {
    slug: "paring-knife",
    name: "Paring Knife",
    category: "paring-knives",
    alt: "Paring knife with a black handle on a plain background",
    description: "<p>A short knife for peeling, trimming and the small work a chef's knife is too big for.</p>",
    material: "Stainless steel blade",
    care: "Hand wash and dry straight away.",
    dishwasherSafe: false,
    variants: one("HP-PK-35", 7_200, 45),
  },
  {
    slug: "bread-knife",
    name: "Serrated Bread Knife",
    category: "bread-knives",
    alt: "Serrated bread knife lying on a wooden board",
    description: "<p>A long serrated blade that saws through a crust without crushing the crumb.</p>",
    material: "Stainless steel blade",
    care: "Hand wash and dry straight away.",
    dishwasherSafe: false,
    variants: one("HP-BK-SR", 11_500, 25),
  },
  {
    slug: "knife-block-set",
    name: "Knife Block Set",
    category: "knife-storage",
    alt: "Wooden knife block with knives on a kitchen counter",
    description: "<p>A wooden block that keeps a set of knives within reach and their edges off the drawer.</p>",
    material: "Wooden block, stainless steel knives",
    care: "Hand wash the knives; wipe the block with a damp cloth.",
    dishwasherSafe: false,
    variants: one("HP-KB-SET", 58_000, 10),
  },
  {
    slug: "magnetic-knife-rack",
    name: "Magnetic Wooden Knife Rack",
    category: "knife-storage",
    alt: "Wall-mounted wooden magnetic rack holding four knives",
    description: "<p>A wall rack with magnetic strips that holds knives blade-out and in plain view.</p>",
    material: "Wood with magnetic strips",
    care: "Wipe with a dry cloth.",
    variants: one("HP-MR-W", 14_500, 18),
  },
  {
    slug: "porcelain-mortar-pestle",
    name: "Porcelain Mortar and Pestle",
    category: "mortars",
    alt: "White porcelain mortar with a pestle resting inside",
    description: "<p>A smooth white porcelain mortar and pestle for grinding spices and pastes.</p>",
    material: "Porcelain",
    care: "Rinse and dry. Dishwasher safe.",
    dishwasherSafe: true,
    variants: one("HP-MP-PO", 9_800, 22),
  },
  {
    slug: "marble-mortar-pestle",
    name: "Marble Mortar and Pestle",
    category: "mortars",
    alt: "Green marble mortar with a stone pestle",
    description: "<p>A heavy stone mortar and pestle that stays put while you crush.</p>",
    material: "Marble",
    care: "Hand wash with water only; no soap, which the stone can absorb.",
    dishwasherSafe: false,
    variants: one("HP-MP-MA", 16_500, 12),
  },
  {
    slug: "brass-mortar-pestle",
    name: "Brass Mortar and Pestle",
    category: "mortars",
    alt: "Brass mortar with two handles and a pestle",
    description: "<p>A brass mortar and pestle with two lug handles, a traditional shape for spices.</p>",
    material: "Brass",
    care: "Hand wash and dry. The brass will darken with age.",
    dishwasherSafe: false,
    variants: one("HP-MP-BR", 12_500, 15),
  },
  {
    slug: "maple-rolling-pin",
    name: "Wooden Rolling Pin",
    category: "rolling-pins",
    alt: "Wooden rolling pin with turned handles on a white background",
    description: "<p>A smooth wooden pin with turned handles for pastry, flatbread and dough.</p>",
    material: "Hardwood",
    care: "Wipe clean with a dry cloth; never soak.",
    dishwasherSafe: false,
    variants: one("HP-RP-W", 6_200, 30),
  },
  {
    slug: "ash-cutting-board",
    name: "Ash Cutting Board",
    category: "cutting-boards",
    alt: "Rectangular pale wooden cutting board with a short handle",
    description: "<p>A light wooden board with a short handle, for chopping and for serving bread.</p>",
    material: "Ash wood",
    care: "Wash by hand and dry upright. Oil now and then.",
    dishwasherSafe: false,
    variants: [
      { sku: "HP-CB-ASH-M", name: "Medium", price: 11_800, stock: 24, size: "Medium" },
      { sku: "HP-CB-ASH-L", name: "Large", price: 15_800, stock: 16, size: "Large" },
    ],
  },
  {
    slug: "wooden-spoon",
    name: "Wooden Cooking Spoon",
    category: "spoons",
    alt: "Long wooden cooking spoon lying on a bench",
    description: "<p>A long wooden spoon that is kind to non-stick and enamel and doesn't conduct heat.</p>",
    material: "Wood",
    care: "Wash by hand and dry.",
    dishwasherSafe: false,
    variants: one("HP-WS-1", 1_800, 60),
  },
  {
    slug: "glass-electric-kettle",
    name: "Glass Electric Kettle",
    category: "kettles-brewing",
    alt: "Glass electric kettle with a white handle and base",
    description: "<p>A glass-bodied electric kettle, so you can see the water come to the boil.</p>",
    material: "Glass body, plastic handle and base",
    care: "Descale regularly. Do not immerse the base.",
    variants: one("HP-KT-GL", 19_500, 20),
  },
  {
    slug: "ceramic-pour-over-dripper",
    name: "Ceramic Pour-Over Dripper",
    category: "kettles-brewing",
    alt: "White ceramic pour-over coffee dripper sitting on a mug",
    description: "<p>A ceramic cone that sits on your mug for pour-over coffee with a paper filter.</p>",
    material: "Ceramic",
    care: "Rinse after use. Dishwasher safe.",
    dishwasherSafe: true,
    variants: one("HP-PO-CE", 7_800, 28),
  },
];

/** Existing sample products that now have a photo of the right item. */
export const PHOTOGRAPHED_SAMPLES: ReadonlyArray<readonly [slug: string, alt: string]> = [
  ["cast-iron-skillet-10in", "Cast iron skillet on a white surface"],
  ["chefs-knife-8in", "Chef's knife with a black handle"],
  ["digital-kitchen-scale", "Digital kitchen scale weighing a tomato"],
];

/** Sample products with no photo of the right item: taken off sale rather than shown without one. */
const UNPHOTOGRAPHED_SAMPLES = [
  "enameled-dutch-oven-5-5qt",
  "tri-ply-saucepan-2qt",
  "silicone-spatula-set-3pc",
  "glass-storage-set-10pc",
  "end-grain-cutting-board",
];

const DEMO_RESTOCK = 25;

export const defaultImageBase = (): string =>
  (process.env.SEED_IMAGE_BASE_URL ?? "http://localhost:3000/products").replace(/\/$/, "");

async function putImage(db: Db, productId: string, slug: string, alt: string, base: string) {
  await db.productImage.deleteMany({ where: { productId } });
  await db.productImage.create({
    data: { productId, key: `products/seed/${slug}.jpg`, url: `${base}/${slug}.jpg`, alt, position: 0 },
  });
}

/**
 * Adds the photographed range, puts real photos on the sample products that match one, takes
 * the rest of the sample products off sale, and zeroes ratings that no review backs. Idempotent.
 */
export async function seedDemoCatalog(db: Db, imageBase = defaultImageBase()): Promise<void> {
  for (const [i, [parentSlug, slug, name]] of DEMO_CATEGORIES.entries()) {
    const parent = await db.category.findUniqueOrThrow({ where: { slug: parentSlug } });
    await db.category.upsert({
      where: { slug },
      create: { slug, name, parentId: parent.id, position: 10 + i },
      update: { name, parentId: parent.id },
    });
  }

  for (const p of DEMO_PRODUCTS) {
    const category = await db.category.findUniqueOrThrow({ where: { slug: p.category } });
    const existing = await db.product.findUnique({ where: { slug: p.slug } });
    const product =
      existing ??
      (await db.product.create({
        data: {
          slug: p.slug,
          name: p.name,
          description: p.description,
          material: p.material,
          careInstructions: p.care,
          dishwasherSafe: p.dishwasherSafe ?? null,
          inductionCompatible: p.inductionCompatible ?? null,
          ovenSafeToF: p.ovenSafeToF ?? null,
          status: "ACTIVE",
          categoryId: category.id,
          variants: {
            create: p.variants.map((v) => ({
              sku: v.sku,
              name: v.name,
              attributes: v.size ? { size: v.size } : {},
              priceCents: v.price,
              stockOnHand: v.stock,
              movements: { create: { delta: v.stock, reason: "RESTOCK", note: "Seed stock" } },
            })),
          },
        },
      }));
    await putImage(db, product.id, p.slug, p.alt, imageBase);
  }

  for (const [slug, alt] of PHOTOGRAPHED_SAMPLES) {
    const product = await db.product.findUnique({ where: { slug } });
    if (!product) continue;
    await putImage(db, product.id, slug, alt, imageBase);
    // The sample data includes a sold-out line for tests; the demo shop stocks it.
    const empty = await db.productVariant.findMany({
      where: { productId: product.id, stockOnHand: 0, isActive: true },
    });
    for (const variant of empty) {
      await db.productVariant.update({
        where: { id: variant.id },
        data: {
          stockOnHand: DEMO_RESTOCK,
          movements: { create: { delta: DEMO_RESTOCK, reason: "RESTOCK", note: "Seed stock" } },
        },
      });
    }
  }
  await db.product.updateMany({
    where: { slug: { in: UNPHOTOGRAPHED_SAMPLES }, status: "ACTIVE" },
    data: { status: "ARCHIVED" },
  });
  // Ratings are only ever what real reviews add up to.
  await db.product.updateMany({
    where: { reviews: { none: {} } },
    data: { ratingAvg: 0, ratingCount: 0 },
  });
}
