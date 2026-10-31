import {
  AdminProductInput,
  type AdminProductDetail,
  type AdminProductUpdate,
  type AdminVariant,
  type AdminVariantInput,
  type AdminVariantPatch,
  type CurrencyCode,
  type ProductStatus,
} from "@hp/contracts";
import type { z } from "zod";
import { toInt } from "@/lib/format";
import { minorToInput, parseMoneyInput } from "@/lib/money";

// Form state is kept as strings (what the inputs hold); these pure functions turn it
// into contract payloads. Stock is never sent for existing variants.

export type TriState = "" | "yes" | "no";

export type VariantRow = {
  rowKey: string;
  /** null for a variant that hasn't been saved yet */
  id: string | null;
  sku: string;
  name: string;
  price: string;
  compareAt: string;
  cost: string;
  lowStockThreshold: string;
  weightGrams: string;
  /** "size=10in, color=Black" */
  attributes: string;
  isActive: boolean;
  /** New rows only. */
  initialStock: string;
  /** Existing rows only; read-only here (changes go through inventory). */
  stockOnHand: number | null;
};

export type ImageRow = { rowKey: string; key: string; url: string; alt: string };

export type ProductFormValues = {
  name: string;
  slug: string;
  brand: string;
  categoryId: string;
  description: string;
  material: string;
  careInstructions: string;
  dishwasherSafe: TriState;
  inductionCompatible: TriState;
  ovenSafeToF: string;
  status: ProductStatus;
  images: ImageRow[];
  variants: VariantRow[];
};

export type FieldErrors = Readonly<Record<string, string>>;

export const DEFAULT_LOW_STOCK = "5";

let rowCounter = 0;
export const nextRowKey = (): string => `row-${++rowCounter}`;

export function emptyVariantRow(): VariantRow {
  return {
    rowKey: nextRowKey(),
    id: null,
    sku: "",
    name: "",
    price: "",
    compareAt: "",
    cost: "",
    lowStockThreshold: DEFAULT_LOW_STOCK,
    weightGrams: "",
    attributes: "",
    isActive: true,
    initialStock: "",
    stockOnHand: null,
  };
}

export function emptyForm(): ProductFormValues {
  return {
    name: "",
    slug: "",
    brand: "",
    categoryId: "",
    description: "",
    material: "",
    careInstructions: "",
    dishwasherSafe: "",
    inductionCompatible: "",
    ovenSafeToF: "",
    status: "DRAFT",
    images: [],
    variants: [emptyVariantRow()],
  };
}

const fromTri = (v: boolean | null): TriState => (v === null ? "" : v ? "yes" : "no");
const toTri = (v: TriState): boolean | null => (v === "" ? null : v === "yes");

export const formatAttributes = (attrs: Readonly<Record<string, string>>): string =>
  Object.entries(attrs)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

/** "size=10in, color=Black" → { size: "10in", color: "Black" }; null when malformed. */
export function parseAttributes(input: string): Record<string, string> | null {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const entries: [string, string][] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0 || eq === part.length - 1) return null;
    entries.push([part.slice(0, eq).trim(), part.slice(eq + 1).trim()]);
  }
  return Object.fromEntries(entries);
}

export function variantRowFrom(v: AdminVariant, currency: CurrencyCode): VariantRow {
  return {
    rowKey: nextRowKey(),
    id: v.id,
    sku: v.sku,
    name: v.name,
    price: minorToInput(v.priceCents, currency),
    compareAt: minorToInput(v.compareAtPriceCents, currency),
    cost: minorToInput(v.costCents, currency),
    lowStockThreshold: String(v.lowStockThreshold),
    weightGrams: v.weightGrams === null ? "" : String(v.weightGrams),
    attributes: formatAttributes(v.attributes),
    isActive: v.isActive,
    initialStock: "",
    stockOnHand: v.stockOnHand,
  };
}

export function formFromDetail(p: AdminProductDetail, currency: CurrencyCode): ProductFormValues {
  return {
    name: p.name,
    slug: p.slug,
    brand: p.brand ?? "",
    categoryId: p.categoryId,
    description: p.description,
    material: p.material ?? "",
    careInstructions: p.careInstructions ?? "",
    dishwasherSafe: fromTri(p.dishwasherSafe),
    inductionCompatible: fromTri(p.inductionCompatible),
    ovenSafeToF: p.ovenSafeToF === null ? "" : String(p.ovenSafeToF),
    status: p.status,
    images: [...p.images]
      .sort((a, b) => a.position - b.position)
      .map((img) => ({ rowKey: nextRowKey(), key: img.key, url: img.url, alt: img.alt })),
    variants: p.variants.map((v) => variantRowFrom(v, currency)),
  };
}

/** "Carbon Steel Wok 14\"" → "carbon-steel-wok-14" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const blankToNull = (s: string): string | null => (s.trim() === "" ? null : s);
const intOrDefault = (s: string, fallback: number) => toInt(s) ?? fallback;

/** The variant as the create schema expects it; existing rows carry no initialStock. */
function rawVariant(row: VariantRow, currency: CurrencyCode) {
  return {
    sku: row.sku,
    name: row.name,
    priceCents: parseMoneyInput(row.price, currency) ?? Number.NaN,
    compareAtPriceCents: parseMoneyInput(row.compareAt, currency),
    costCents: parseMoneyInput(row.cost, currency),
    lowStockThreshold: intOrDefault(row.lowStockThreshold, Number(DEFAULT_LOW_STOCK)),
    weightGrams: toInt(row.weightGrams),
    attributes: parseAttributes(row.attributes) ?? {},
    isActive: row.isActive,
    ...(row.id === null && { initialStock: intOrDefault(row.initialStock, 0) }),
  };
}

function rawProduct(form: ProductFormValues, currency: CurrencyCode) {
  return {
    name: form.name,
    slug: form.slug,
    brand: blankToNull(form.brand),
    categoryId: form.categoryId,
    description: form.description,
    material: blankToNull(form.material),
    careInstructions: blankToNull(form.careInstructions),
    dishwasherSafe: toTri(form.dishwasherSafe),
    inductionCompatible: toTri(form.inductionCompatible),
    ovenSafeToF: toInt(form.ovenSafeToF),
    status: form.status,
    images: form.images.map((img, position) => ({ key: img.key, alt: img.alt, position })),
    variants: form.variants.map((row) => rawVariant(row, currency)),
  };
}

const MONEY_FIELDS = new Set(["priceCents", "compareAtPriceCents", "costCents"]);

function friendlyMessage(issue: z.ZodIssue): string {
  const field = String(issue.path[issue.path.length - 1] ?? "");
  if (issue.code === "invalid_type") {
    if (MONEY_FIELDS.has(field)) return "Enter an amount like 18.500.";
    if (issue.received === "nan") return "Enter a whole number.";
    if (issue.received === "undefined" || issue.received === "null") return "Required.";
  }
  if (issue.code === "too_small" && issue.minimum === 1 && issue.type === "string")
    return "Required.";
  return issue.message;
}

export type Validated = { ok: true; data: AdminProductInput } | { ok: false; errors: FieldErrors };

/** Client validation with the contract's create schema; errors are keyed by path ("variants.0.sku"). */
export function validateForm(form: ProductFormValues, currency: CurrencyCode): Validated {
  const errors: Record<string, string> = {};
  form.variants.forEach((row, i) => {
    if (parseAttributes(row.attributes) === null) {
      errors[`variants.${i}.attributes`] = "Use key=value pairs separated by commas.";
    }
  });
  if (form.categoryId === "") errors.categoryId = "Choose a category.";
  const parsed = AdminProductInput.safeParse(rawProduct(form, currency));
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => {
      const path = issue.path.join(".");
      errors[path] ??= friendlyMessage(issue);
    });
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: parsed.data };
}

const PRODUCT_FIELDS = [
  "name",
  "slug",
  "brand",
  "categoryId",
  "description",
  "material",
  "careInstructions",
  "dishwasherSafe",
  "inductionCompatible",
  "ovenSafeToF",
  "status",
] as const;

const VARIANT_FIELDS = [
  "sku",
  "name",
  "priceCents",
  "compareAtPriceCents",
  "costCents",
  "lowStockThreshold",
  "weightGrams",
  "attributes",
  "isActive",
] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PATCH body: only fields that differ from `original`. Existing variants become
 * AdminVariantPatch ({ id, ...changed }); new rows are full AdminVariantInput with
 * initialStock. Images are sent as a whole list when anything about them changed.
 */
export function buildPatch(
  data: AdminProductInput,
  form: ProductFormValues,
  original: AdminProductDetail,
): AdminProductUpdate {
  const fields = Object.fromEntries(
    PRODUCT_FIELDS.filter((key) => !same(data[key], original[key])).map((key) => [key, data[key]]),
  );

  const originalImages = [...original.images]
    .sort((a, b) => a.position - b.position)
    .map((img, position) => ({ key: img.key, alt: img.alt, position }));
  const images = same(data.images, originalImages) ? {} : { images: data.images };

  const variants = form.variants.flatMap((row, i): (AdminVariantPatch | AdminVariantInput)[] => {
    const next = data.variants[i]!;
    if (row.id === null) return [next];
    const before = original.variants.find((v) => v.id === row.id);
    if (!before) return [];
    const changed = VARIANT_FIELDS.filter((key) => !same(next[key], before[key]));
    if (changed.length === 0) return [];
    const patch: AdminVariantPatch = {
      id: row.id,
      ...Object.fromEntries(changed.map((key) => [key, next[key]])),
    };
    return [patch];
  });

  return { ...fields, ...images, ...(variants.length > 0 && { variants }) } as AdminProductUpdate;
}

/** True when compare-at is set but not above the price (the contract rejects it). */
export function compareAtTooLow(row: VariantRow, currency: CurrencyCode): boolean {
  const price = parseMoneyInput(row.price, currency);
  const compareAt = parseMoneyInput(row.compareAt, currency);
  return (
    price !== null &&
    compareAt !== null &&
    Number.isFinite(price) &&
    Number.isFinite(compareAt) &&
    compareAt <= price
  );
}
