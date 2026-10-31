import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sampleCatalog, toSummary } from "@hp/test-utils";
import { DEFAULT_QUERY } from "@/lib/query";
import { navigationMock } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";
import { ListingView } from "./ListingView";

vi.mock("next/navigation", () => navigationMock());

const products = sampleCatalog().map(toSummary);

describe("ListingView", () => {
  it("shows the count, search term, grid and pagination", async () => {
    renderWithProviders(
      <ListingView
        eyebrow="All"
        heading="Shop all"
        basePath="/shop"
        query={{ ...DEFAULT_QUERY, q: "pan" }}
        result={{
          products: products.slice(0, 2),
          meta: { page: 1, pageSize: 2, total: 8, totalPages: 4 },
        }}
        facets={null}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Shop all" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /8 products/ })).toHaveTextContent(
      "8 products for “pan”",
    );
    // The grid sits inside a lazily loaded animation wrapper, so it appears a tick later.
    expect(await screen.findAllByRole("article", {}, { timeout: 5000 })).toHaveLength(2);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });

  it("shows an empty state with a way back", () => {
    renderWithProviders(
      <ListingView
        eyebrow="Dept"
        heading="Skillets"
        basePath="/c/skillets"
        query={{ ...DEFAULT_QUERY, category: "skillets" }}
        result={{ products: [], meta: { page: 1, pageSize: 24, total: 0, totalPages: 0 } }}
        facets={null}
        omitCategory
      />,
    );
    expect(screen.getByText("0 products")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/c/skillets",
    );
  });
});
