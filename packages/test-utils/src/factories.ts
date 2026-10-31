import {
  Cart,
  CartLine,
  Category,
  OrderDetail,
  ProductDetail,
  ProductSummary,
  ProductVariant,
  PublicUser,
  formatOrderNumber,
  type CurrencyCode,
} from "@hp/contracts";

// Every factory parses its output through the contract schema, so a factory can
// never hand a test data that the real API would reject.

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++sequence).padStart(4, "0")}`;

/** Call in beforeEach to make generated ids deterministic per test. */
export function resetFactorySequence(): void {
  sequence = 0;
}

const CDN = "https://cdn.example.test/products";
const FIXED_TIMESTAMP = "2026-10-01T12:00:00.000Z";

// ---------- Sample kitchen catalog (fictional brands) ----------

type VariantSeed = {
  sku: string;
  name: string;
  priceCents: number;
  compareAtPriceCents?: number;
  stock: number;
  attributes: Record<string, string>;
};

type ProductSeed = {
  slug: string;
  name: string;
  brand: string;
  categorySlug: string;
  description: string;
  material: string;
  care: string;
  dishwasherSafe: boolean;
  inductionCompatible: boolean | null;
  ovenSafeToF: number | null;
  ratingAvg: number;
  ratingCount: number;
  variants: VariantSeed[];
};

const SAMPLE_PRODUCTS: readonly ProductSeed[] = [
  {
    slug: "cast-iron-skillet-10in",
    name: 'Cast Iron Skillet 10"',
    brand: "Ironvale",
    categorySlug: "skillets",
    description: "<p>Pre-seasoned and ready to sear, bake and fry.</p>",
    material: "Cast iron",
    care: "Hand wash, dry immediately, then oil lightly.",
    dishwasherSafe: false,
    inductionCompatible: true,
    ovenSafeToF: 500,
    ratingAvg: 4.8,
    ratingCount: 1290,
    variants: [
      {
        sku: "IV-SK10",
        name: "10 inch",
        priceCents: 3499,
        stock: 24,
        attributes: { size: "10in" },
      },
      { sku: "IV-SK12", name: "12 inch", priceCents: 4499, stock: 8, attributes: { size: "12in" } },
    ],
  },
  {
    slug: "enameled-dutch-oven-5-5qt",
    name: "Enameled Dutch Oven 5.5 qt",
    brand: "Northfold",
    categorySlug: "dutch-ovens",
    description: "<p>Heavy enameled cast iron for braises, stews and bread.</p>",
    material: "Enameled cast iron",
    care: "Hand wash recommended. Avoid metal scouring pads.",
    dishwasherSafe: false,
    inductionCompatible: true,
    ovenSafeToF: 500,
    ratingAvg: 4.9,
    ratingCount: 412,
    variants: [
      {
        sku: "NF-DO55-COB",
        name: "Cobalt",
        priceCents: 21900,
        compareAtPriceCents: 25900,
        stock: 6,
        attributes: { color: "Cobalt", capacity: "5.5qt" },
      },
      {
        sku: "NF-DO55-SAG",
        name: "Sage",
        priceCents: 21900,
        stock: 0,
        attributes: { color: "Sage", capacity: "5.5qt" },
      },
    ],
  },
  {
    slug: "tri-ply-saucepan-2qt",
    name: "Tri-Ply Stainless Saucepan 2 qt",
    brand: "Copperline",
    categorySlug: "saucepans",
    description: "<p>Even heating from base to rim, with a tight-fitting lid.</p>",
    material: "Stainless steel (tri-ply)",
    care: "Dishwasher safe; hand washing keeps it bright.",
    dishwasherSafe: true,
    inductionCompatible: true,
    ovenSafeToF: 600,
    ratingAvg: 4.6,
    ratingCount: 233,
    variants: [
      { sku: "CL-SP2", name: "2 qt", priceCents: 6999, stock: 15, attributes: { capacity: "2qt" } },
    ],
  },
  {
    slug: "chefs-knife-8in",
    name: "Chef's Knife 8\"",
    brand: "Brisa",
    categorySlug: "chefs-knives",
    description: "<p>A balanced all-purpose blade, hand-honed to 15° per side.</p>",
    material: "High-carbon stainless steel",
    care: "Hand wash and dry. Never put in the dishwasher.",
    dishwasherSafe: false,
    inductionCompatible: null,
    ovenSafeToF: null,
    ratingAvg: 4.7,
    ratingCount: 870,
    variants: [
      { sku: "BR-CK8", name: "8 inch", priceCents: 8900, stock: 30, attributes: { length: "8in" } },
    ],
  },
  {
    slug: "end-grain-cutting-board",
    name: "End-Grain Maple Cutting Board",
    brand: "Northfold",
    categorySlug: "cutting-boards",
    description: "<p>Kind to knife edges and heavy enough to stay put.</p>",
    material: "Maple",
    care: "Hand wash; oil monthly with food-safe mineral oil.",
    dishwasherSafe: false,
    inductionCompatible: null,
    ovenSafeToF: null,
    ratingAvg: 4.8,
    ratingCount: 151,
    variants: [
      {
        sku: "NF-CB-M",
        name: "Medium",
        priceCents: 7900,
        stock: 12,
        attributes: { size: "Medium" },
      },
      { sku: "NF-CB-L", name: "Large", priceCents: 10900, stock: 4, attributes: { size: "Large" } },
    ],
  },
  {
    slug: "silicone-spatula-set-3pc",
    name: "Silicone Spatula Set, 3 pc",
    brand: "Brisa",
    categorySlug: "spatulas",
    description: "<p>Heat-safe heads on a stainless core, sized for bowls, jars and pans.</p>",
    material: "Silicone, stainless steel core",
    care: "Dishwasher safe.",
    dishwasherSafe: true,
    inductionCompatible: null,
    ovenSafeToF: 600,
    ratingAvg: 4.5,
    ratingCount: 1022,
    variants: [
      { sku: "BR-SP3", name: "3 piece", priceCents: 1499, stock: 80, attributes: { pieces: "3" } },
    ],
  },
  {
    slug: "glass-storage-set-10pc",
    name: "Glass Food Storage Set, 10 pc",
    brand: "Copperline",
    categorySlug: "food-storage",
    description: "<p>Borosilicate containers with locking lids, oven to table to fridge.</p>",
    material: "Borosilicate glass",
    care: "Dishwasher, microwave and freezer safe.",
    dishwasherSafe: true,
    inductionCompatible: null,
    ovenSafeToF: 450,
    ratingAvg: 4.4,
    ratingCount: 389,
    variants: [
      {
        sku: "CL-GS10",
        name: "10 piece",
        priceCents: 3999,
        stock: 40,
        attributes: { pieces: "10" },
      },
    ],
  },
  {
    slug: "digital-kitchen-scale",
    name: "Digital Kitchen Scale",
    brand: "Ironvale",
    categorySlug: "kitchen-scales",
    description: "<p>Weighs to 1 g up to 5 kg, with tare and unit switching.</p>",
    material: "Stainless steel, ABS",
    care: "Wipe clean. Do not submerge.",
    dishwasherSafe: false,
    inductionCompatible: null,
    ovenSafeToF: null,
    ratingAvg: 4.3,
    ratingCount: 598,
    variants: [
      { sku: "IV-KS5", name: "5 kg", priceCents: 2499, stock: 0, attributes: { capacity: "5kg" } },
    ],
  },
];

const deriveSummaryFields = (variants: readonly ProductVariant[]) => ({
  fromPriceCents: Math.min(...variants.map((v) => v.priceCents)),
  inStock: variants.some((v) => v.stockAvailable > 0),
});

function productFromSeed(seed: ProductSeed, index: number): ProductDetail {
  const num = String(index + 1).padStart(2, "0");
  const variants = seed.variants.map((v, i) => ({
    id: `v_sample_${num}_${i + 1}`,
    sku: v.sku,
    name: v.name,
    priceCents: v.priceCents,
    compareAtPriceCents: v.compareAtPriceCents ?? null,
    stockAvailable: v.stock,
    attributes: v.attributes,
  }));
  const imageUrl = `${CDN}/${seed.slug}.webp`;
  return ProductDetail.parse({
    id: `p_sample_${num}`,
    slug: seed.slug,
    name: seed.name,
    brand: seed.brand,
    categorySlug: seed.categorySlug,
    thumbnailUrl: imageUrl,
    ratingAvg: seed.ratingAvg,
    ratingCount: seed.ratingCount,
    description: seed.description,
    material: seed.material,
    careInstructions: seed.care,
    dishwasherSafe: seed.dishwasherSafe,
    inductionCompatible: seed.inductionCompatible,
    ovenSafeToF: seed.ovenSafeToF,
    images: [{ id: `img_sample_${num}`, url: imageUrl, alt: seed.name, position: 0 }],
    variants,
    ...deriveSummaryFields(variants),
  });
}

/** Eight realistic kitchen products, including out-of-stock items. Fresh objects every call. */
export function sampleCatalog(): ProductDetail[] {
  return SAMPLE_PRODUCTS.map(productFromSeed);
}

export function toSummary(product: ProductDetail): ProductSummary {
  return ProductSummary.parse({
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    categorySlug: product.categorySlug,
    thumbnailUrl: product.images[0]?.url ?? null,
    ratingAvg: product.ratingAvg,
    ratingCount: product.ratingCount,
    ...deriveSummaryFields(product.variants),
  });
}

export function makeCategoryTree(): Category[] {
  const node = (slug: string, name: string, children: Category[] = []): Category => ({
    id: `cat_${slug}`,
    slug,
    name,
    children,
  });
  return [
    node("cookware", "Cookware", [
      node("skillets", "Skillets"),
      node("dutch-ovens", "Dutch Ovens"),
      node("saucepans", "Saucepans"),
    ]),
    node("knives-cutlery", "Knives & Cutlery", [node("chefs-knives", "Chef's Knives")]),
    node("utensils-tools", "Utensils & Tools", [
      node("spatulas", "Spatulas"),
      node("cutting-boards", "Cutting Boards"),
    ]),
    node("storage", "Storage", [node("food-storage", "Food Storage")]),
    node("small-appliances", "Small Appliances", [node("kitchen-scales", "Kitchen Scales")]),
  ].map((c) => Category.parse(c));
}

// ---------- Generated (non-sample) builders ----------

export function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  const id = nextId("v");
  return ProductVariant.parse({
    id,
    sku: `TEST-${id.replace("_", "-").toUpperCase()}`,
    name: "Standard",
    priceCents: 2999,
    compareAtPriceCents: null,
    stockAvailable: 10,
    attributes: {},
    ...overrides,
  });
}

export function makeProductDetail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  const id = nextId("p");
  const variants = overrides.variants ?? [makeVariant(), makeVariant({ priceCents: 3999 })];
  const slug = `test-product-${id.split("_")[1]}`;
  return ProductDetail.parse({
    id,
    slug,
    name: "Test Saute Pan",
    brand: "Ironvale",
    categorySlug: "skillets",
    thumbnailUrl: `${CDN}/${slug}.webp`,
    ratingAvg: 4.5,
    ratingCount: 10,
    description: "<p>Test product.</p>",
    material: "Stainless steel",
    careInstructions: "Dishwasher safe.",
    dishwasherSafe: true,
    inductionCompatible: true,
    ovenSafeToF: 500,
    images: [{ id: nextId("img"), url: `${CDN}/${slug}.webp`, alt: "Test Saute Pan", position: 0 }],
    variants,
    ...deriveSummaryFields(variants),
    ...overrides,
  });
}

export function makeCartLine(overrides: Partial<CartLine> = {}): CartLine {
  const merged = {
    id: nextId("line"),
    variantId: nextId("v"),
    productSlug: "cast-iron-skillet-10in",
    productName: 'Cast Iron Skillet 10"',
    variantName: "10 inch",
    sku: "IV-SK10",
    thumbnailUrl: null,
    unitPriceCents: 3499,
    quantity: 1,
    stockAvailable: 24,
    ...overrides,
  };
  return CartLine.parse({
    ...merged,
    lineTotalCents: overrides.lineTotalCents ?? merged.unitPriceCents * merged.quantity,
  });
}

type CartOptions = {
  id?: string;
  couponCode?: string | null;
  shippingCents?: number;
  discountCents?: number;
  taxCents?: number;
  currency?: CurrencyCode;
};

export function makeCart(items: readonly CartLine[] = [], options: CartOptions = {}): Cart {
  const subtotalCents = items.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const { shippingCents = 0, discountCents = 0, taxCents = 0 } = options;
  return Cart.parse({
    id: options.id ?? nextId("cart"),
    items,
    couponCode: options.couponCode ?? null,
    totals: {
      subtotalCents,
      discountCents,
      shippingCents,
      taxCents,
      totalCents: subtotalCents - discountCents + shippingCents + taxCents,
    },
    currency: options.currency ?? "OMR",
  });
}

export function makePublicUser(overrides: Partial<PublicUser> = {}): PublicUser {
  const id = nextId("u");
  return PublicUser.parse({
    id,
    email: `${id}@example.test`,
    firstName: "Ada",
    lastName: "Cook",
    role: "CUSTOMER",
    emailVerified: true,
    ...overrides,
  });
}

export function makeOrderDetail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  const id = nextId("o");
  const unitPriceCents = 3499;
  const quantity = 2;
  const subtotalCents = unitPriceCents * quantity;
  const shippingCents = 0;
  const taxCents = Math.round(subtotalCents * 0.0825);
  const totalCents = subtotalCents + shippingCents + taxCents;
  return OrderDetail.parse({
    id,
    number: formatOrderNumber(2026, sequence),
    status: "PAID",
    totalCents,
    itemCount: quantity,
    createdAt: FIXED_TIMESTAMP,
    email: "ada@example.test",
    items: [
      {
        id: nextId("oi"),
        variantId: "v_sample_01_1",
        productName: 'Cast Iron Skillet 10"',
        variantName: "10 inch",
        sku: "IV-SK10",
        unitPriceCents,
        quantity,
        lineTotalCents: subtotalCents,
      },
    ],
    totals: { subtotalCents, discountCents: 0, shippingCents, taxCents, totalCents },
    refundedCents: 0,
    refundState: "NONE",
    shippingAddress: {
      fullName: "Salim Al Harthy",
      line1: "Al Khuwair, Way 3021",
      city: "Bawshar",
      region: "MA",
      postalCode: "133",
      country: "OM",
      phone: "+96891234567",
    },
    currency: "OMR",
    paymentMethod: "card",
    paymentLabel: null,
    paymentDueAt: null,
    bankTransfer: null,
    manualPayment: null,
    shippingMethod: "standard",
    trackingNumber: null,
    carrier: null,
    estimatedDeliveryAt: null,
    couponCode: null,
    paidAt: FIXED_TIMESTAMP,
    events: [
      {
        id: nextId("ev"),
        type: "created",
        fromStatus: null,
        toStatus: "PENDING_PAYMENT",
        message: null,
        createdAt: FIXED_TIMESTAMP,
      },
      {
        id: nextId("ev"),
        type: "payment_succeeded",
        fromStatus: "PENDING_PAYMENT",
        toStatus: "PAID",
        message: null,
        createdAt: FIXED_TIMESTAMP,
      },
    ],
    ...overrides,
  });
}
