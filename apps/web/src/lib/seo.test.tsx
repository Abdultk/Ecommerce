import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductDetail } from "@hp/contracts";
import { sampleCatalog } from "@hp/test-utils";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  organizationJsonLd,
  productJsonLd,
  serializeJsonLd,
  stripTags,
  websiteJsonLd,
} from "./json-ld";
import { sanitizeProductHtml } from "./sanitize";
import { pageMetadata } from "./seo";

describe("sanitizeProductHtml (render-time defence in depth)", () => {
  it("keeps the formatting allow-list", () => {
    const html =
      "<h3>Care</h3><p>Use <strong>oil</strong>, <em>not</em> soap.</p><ul><li>Dry</li></ul>";
    expect(sanitizeProductHtml(html)).toBe(html);
  });

  it("drops scripts, event handlers, styles, images and iframes", () => {
    const dirty =
      '<p onclick="alert(1)" style="color:red">Hi</p><script>alert(1)</script>' +
      '<img src=x onerror="alert(1)"><iframe src="https://evil.test"></iframe><style>p{}</style>';
    expect(sanitizeProductHtml(dirty)).toBe("<p>Hi</p>");
  });

  it("strips unsafe link schemes and hardens safe links", () => {
    expect(sanitizeProductHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeProductHtml('<a href="  JaVaScRiPt:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeProductHtml('<a href="//evil.test">x</a>')).toBe("<a>x</a>");
    expect(sanitizeProductHtml('<a href="https://ok.test/a" onclick="x()">ok</a>')).toBe(
      '<a href="https://ok.test/a" rel="noopener noreferrer nofollow" target="_blank">ok</a>',
    );
  });

  it("neutralises markup smuggled through attributes and comments", () => {
    const out = sanitizeProductHtml(
      '<p title="</p><script>x</script>">a</p><!-- <script>y</script> -->',
    );
    expect(out).not.toMatch(/<script|title=/i);
  });
});

describe("JSON-LD serialisation", () => {
  it("escapes characters that could end the script element or confuse an HTML parser", () => {
    const out = serializeJsonLd({ name: "</script><!-- & \u2028" });
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual({ name: "</script><!-- & \u2028" });
  });

  it("renders a data block carrying the request nonce", () => {
    const html = renderToStaticMarkup(<JsonLd data={{ a: "</script>" }} nonce="n0nce" />);
    expect(html).toBe(
      '<script type="application/ld+json" nonce="n0nce">{"a":"\\u003c/script\\u003e"}</script>',
    );
  });

  it("decodes entities when turning description HTML into plain text", () => {
    expect(stripTags("<p>Salt &amp; pepper</p><p>Oven&nbsp;safe &lt;500&deg;F&gt;</p>")).toBe(
      "Salt & pepper Oven safe <500°F>",
    );
  });
});

describe("structured data builders", () => {
  it("describes the organisation and a site search action for the home page", () => {
    expect(organizationJsonLd("https://shop.test")).toMatchObject({
      "@type": "Organization",
      name: "PAISLEY art",
      url: "https://shop.test/",
    });
    expect(websiteJsonLd("https://shop.test").potentialAction).toEqual({
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: "https://shop.test/shop?q={search_term_string}",
      },
      "query-input": "required name=search_term_string",
    });
  });

  it("gives each offer its price in the store currency, availability and page URL", () => {
    const product = ProductDetail.parse(sampleCatalog()[1]);
    const ld = productJsonLd(product, "https://shop.test/p/x", "OMR");
    expect(ld.offers[0]).toMatchObject({
      "@type": "Offer",
      priceCurrency: "OMR",
      url: "https://shop.test/p/x",
    });
    expect(ld.aggregateRating).toMatchObject({ "@type": "AggregateRating", bestRating: 5 });
  });
});

describe("pageMetadata", () => {
  it("sets the canonical URL, Open Graph and Twitter cards for a page", () => {
    const meta = pageMetadata({
      title: "Cast Iron Skillet",
      description: "Pre-seasoned.",
      path: "/p/skillet",
      images: [{ url: "https://img.test/a.webp", alt: "Skillet" }],
    });
    expect(meta.alternates).toEqual({ canonical: "/p/skillet" });
    expect(meta.openGraph).toMatchObject({
      siteName: "PAISLEY art",
      url: "/p/skillet",
      title: "Cast Iron Skillet",
      images: [{ url: "https://img.test/a.webp", alt: "Skillet" }],
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "Cast Iron Skillet" });
  });

  it("falls back to a summary card without images", () => {
    expect(pageMetadata({ title: "Shop", description: "d", path: "/shop" }).twitter).toMatchObject({
      card: "summary",
    });
  });
});
