import { describe, expect, it } from "vitest";
import { withLiveProducts } from "./catalog.service";

const rows = [
  { id: "cookware", parentId: null },
  { id: "skillets", parentId: "cookware" },
  { id: "stands", parentId: null },
  { id: "tiered", parentId: "stands" },
  { id: "empty", parentId: null },
];

describe("withLiveProducts", () => {
  it("keeps a category with live products and its parents, and drops empty ones", () => {
    expect(withLiveProducts(rows, new Set(["tiered"])).map((r) => r.id)).toEqual([
      "stands",
      "tiered",
    ]);
  });

  it("lists nothing when no product is live", () => {
    expect(withLiveProducts(rows, new Set())).toEqual([]);
  });

  it("ignores a live product whose category is unknown", () => {
    expect(withLiveProducts(rows, new Set(["gone"])).map((r) => r.id)).toEqual([]);
  });
});
