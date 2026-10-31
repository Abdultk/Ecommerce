import { currencyExponent, type CurrencyCode, type ProductDetail } from "@hp/contracts";

export const SITE_NAME = "PAISLEY art";

// Line and paragraph separators (U+2028, U+2029), built here to keep the source ASCII.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const UNSAFE_IN_SCRIPT = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, "g");

const BACKSLASH = String.fromCharCode(0x5c);

const unicodeEscape = (ch: string): string =>
  `${BACKSLASH}u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;

/**
 * Serialises JSON-LD for a <script> data block. <, > and & are escaped so content such as
 * "</script>" or "<!--" can never end or confuse the element (the HTML parser ignores JSON
 * escaping); U+2028/2029 are escaped for older JS parsers. The result is still valid JSON.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(UNSAFE_IN_SCRIPT, unicodeEscape);
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  deg: "°",
};

/** Plain text from (sanitized) description HTML, for meta descriptions and JSON-LD. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|lt|gt|quot|#39|deg);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Offer prices in the store currency, as schema.org expects: "21.900" OMR, "219.00" USD. */
export function productJsonLd(product: ProductDetail, url: string, currency: CurrencyCode) {
  const exponent = currencyExponent(currency);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: stripTags(product.description),
    url,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: product.images.map((i) => i.url),
    sku: product.variants[0]?.sku,
    material: product.material ?? undefined,
    aggregateRating:
      product.ratingCount > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: product.ratingAvg,
            reviewCount: product.ratingCount,
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
    offers: product.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      name: v.name,
      url,
      price: (v.priceCents / 10 ** exponent).toFixed(exponent),
      priceCurrency: currency,
      availability:
        v.stockAvailable > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
    })),
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function organizationJsonLd(siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: `${siteUrl}/`,
  };
}

/** Lets search engines offer a site search box that lands on /shop?q=… */
export function websiteJsonLd(siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${siteUrl}/`,
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/shop?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}
