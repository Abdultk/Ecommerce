import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  buildListingHref,
  countActiveFilters,
  parseProductQuery,
  toApiQueryString,
} from "./query";

describe("parseProductQuery", () => {
  it("parses search params, including repeated keys, into a ProductQuery", () => {
    const query = parseProductQuery({
      q: "skillet",
      brand: ["Ironvale", "Brisa"],
      inStock: "true",
      sort: "price_asc",
      page: "2",
    });
    expect(query).toMatchObject({
      q: "skillet",
      brand: ["Ironvale", "Brisa"],
      inStock: true,
      sort: "price_asc",
      page: 2,
      pageSize: 24,
    });
  });

  it("falls back to the defaults when any param is invalid", () => {
    expect(parseProductQuery({ sort: "cheapest", page: "-3" })).toEqual(DEFAULT_QUERY);
    expect(parseProductQuery({ minPrice: "5000", maxPrice: "100" })).toEqual(DEFAULT_QUERY);
  });

  it("returns defaults for empty params", () => {
    expect(parseProductQuery({})).toEqual({ sort: "relevance", page: 1, pageSize: 24 });
  });
});

describe("toApiQueryString", () => {
  it("serialises every set value, repeating array keys", () => {
    const qs = toApiQueryString({
      ...DEFAULT_QUERY,
      q: "pan",
      brand: ["Ironvale", "Brisa"],
      inductionCompatible: true,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("q")).toBe("pan");
    expect(params.getAll("brand")).toEqual(["Ironvale", "Brisa"]);
    expect(params.get("inductionCompatible")).toBe("true");
    expect(params.get("sort")).toBe("relevance");
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("24");
  });

  it("round-trips through parseProductQuery", () => {
    const original = parseProductQuery({ material: ["Maple"], minPrice: "1000", sort: "popular" });
    const params = new URLSearchParams(toApiQueryString(original));
    const record: Record<string, string | string[]> = {};
    for (const key of new Set(params.keys())) {
      const all = params.getAll(key);
      record[key] = all.length === 1 ? all[0]! : all;
    }
    expect(parseProductQuery(record)).toEqual(original);
  });
});

describe("buildListingHref", () => {
  it("drops default values so canonical URLs stay clean", () => {
    expect(buildListingHref("/shop", DEFAULT_QUERY)).toBe("/shop");
  });

  it("applies a patch and resets to page 1 when filters change", () => {
    const current = { ...DEFAULT_QUERY, page: 3 };
    expect(buildListingHref("/shop", current, { brand: ["Brisa"] })).toBe("/shop?brand=Brisa");
  });

  it("keeps the requested page when the patch sets it", () => {
    const current = { ...DEFAULT_QUERY, q: "knife" };
    expect(buildListingHref("/shop", current, { page: 2 })).toBe("/shop?q=knife&page=2");
  });

  it("removes a key when the patch sets it to undefined or an empty array", () => {
    const current = { ...DEFAULT_QUERY, brand: ["Brisa"], inStock: true };
    expect(buildListingHref("/shop", current, { brand: [], inStock: undefined })).toBe("/shop");
  });

  it("omits the category on category pages, where it lives in the path", () => {
    const current = { ...DEFAULT_QUERY, category: "skillets", sort: "price_desc" as const };
    expect(buildListingHref("/c/skillets", current, {}, { omitCategory: true })).toBe(
      "/c/skillets?sort=price_desc",
    );
  });
});

describe("countActiveFilters", () => {
  it("counts filters but not sort, paging or search", () => {
    expect(countActiveFilters(DEFAULT_QUERY)).toBe(0);
    expect(
      countActiveFilters({
        ...DEFAULT_QUERY,
        q: "pan",
        brand: ["A", "B"],
        material: ["Maple"],
        minPrice: 100,
        inStock: true,
      }),
    ).toBe(5);
  });
});
