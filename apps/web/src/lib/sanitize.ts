import sanitizeHtml from "sanitize-html";

/**
 * Product descriptions are sanitized by the API on save; the storefront sanitizes again at
 * render time (server components only, so the library never ships to the browser) in case
 * stored HTML predates the policy or a bypass is found. Mirrors apps/api/src/lib/sanitize.ts:
 * a small formatting allow-list, safe links only, no images, scripts, styles or attributes.
 */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "b",
    "i",
    "ul",
    "ol",
    "li",
    "h3",
    "h4",
    "blockquote",
    "a",
  ],
  allowedAttributes: { a: ["href", "rel", "target"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    // Runs before scheme filtering, so it checks the scheme itself: unsafe links lose all attributes.
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const href = attribs.href?.trim() ?? "";
      if (!SAFE_LINK.test(href)) return { tagName, attribs: {} };
      return { tagName, attribs: { href, rel: "noopener noreferrer nofollow", target: "_blank" } };
    },
  },
};

export const sanitizeProductHtml = (html: string): string => sanitizeHtml(html, OPTIONS).trim();
