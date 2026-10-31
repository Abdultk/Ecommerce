import { screen } from "@testing-library/react";
import { renderWithProviders as render } from "@/test/render";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductFacets } from "@hp/contracts";
import { sampleCatalog } from "@hp/test-utils";
import { DEFAULT_QUERY } from "@/lib/query";
import { navigationMock, routerSpies } from "@/test/navigation";
import { FilterSidebar } from "./FilterSidebar";

vi.mock("next/navigation", () => navigationMock());

const catalog = sampleCatalog();
const countValues = (values: readonly (string | null)[]) =>
  [...new Set(values.filter((v): v is string => v !== null))].map((value) => ({
    value,
    count: values.filter((v) => v === value).length,
  }));
const facets: ProductFacets = {
  brands: countValues(catalog.map((p) => p.brand)),
  materials: countValues(catalog.map((p) => p.material)),
  priceRanges: [{ minCents: 0, maxCents: null, count: catalog.length }],
};

describe("FilterSidebar", () => {
  beforeEach(() => routerSpies.push.mockClear());

  it("adds a brand to the URL when its checkbox is ticked", async () => {
    const user = userEvent.setup();
    render(
      <FilterSidebar basePath="/shop" query={{ ...DEFAULT_QUERY, page: 3 }} facets={facets} />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Northfold/ }));

    expect(routerSpies.push).toHaveBeenCalledWith("/shop?brand=Northfold", { scroll: false });
  });

  it("removes a brand that is already active", async () => {
    const user = userEvent.setup();
    const query = { ...DEFAULT_QUERY, brand: ["Brisa", "Northfold"] };
    render(<FilterSidebar basePath="/shop" query={query} facets={facets} />);

    const brisa = screen.getByRole("checkbox", { name: /Brisa/ });
    expect(brisa).toBeChecked();
    await user.click(brisa);

    expect(routerSpies.push).toHaveBeenCalledWith("/shop?brand=Northfold", { scroll: false });
  });

  it("toggles the in-stock filter and offers no induction filter", async () => {
    const user = userEvent.setup();
    render(<FilterSidebar basePath="/shop" query={DEFAULT_QUERY} facets={facets} />);

    await user.click(screen.getByRole("checkbox", { name: /in stock only/i }));
    expect(routerSpies.push).toHaveBeenLastCalledWith("/shop?inStock=true", { scroll: false });

    // No catalogue product records induction suitability, so the sidebar does not offer it.
    expect(screen.queryByRole("checkbox", { name: /induction/i })).not.toBeInTheDocument();
  });

  it("applies a price range typed in the store currency as its minor units", async () => {
    const user = userEvent.setup();
    // No provider: the default store config (OMR, three decimals) applies.
    render(<FilterSidebar basePath="/shop" query={DEFAULT_QUERY} facets={facets} />);

    await user.type(screen.getByLabelText("Min price (OMR)"), "2");
    await user.type(screen.getByLabelText("Max price (OMR)"), "7.525");
    await user.click(screen.getByRole("button", { name: /apply price/i }));

    expect(routerSpies.push).toHaveBeenCalledWith("/shop?minPrice=2000&maxPrice=7525", {
      scroll: false,
    });
  });

  it("shows the applied range back in major units and rejects extra decimals", async () => {
    const user = userEvent.setup();
    const query = { ...DEFAULT_QUERY, minPrice: 18_500 };
    render(<FilterSidebar basePath="/shop" query={query} facets={facets} />);

    const min = screen.getByLabelText(/min price/i);
    expect(min).toHaveValue("18.5");
    await user.type(min, "0001");
    await user.click(screen.getByRole("button", { name: /apply price/i }));

    expect(routerSpies.push).not.toHaveBeenCalled();
    expect(min).toHaveAccessibleDescription(/up to 3 decimals/i);
  });

  it("shows an error instead of navigating when min is above max", async () => {
    const user = userEvent.setup();
    render(<FilterSidebar basePath="/shop" query={DEFAULT_QUERY} facets={facets} />);

    await user.type(screen.getByLabelText(/min price/i), "90");
    await user.type(screen.getByLabelText(/max price/i), "10");
    await user.click(screen.getByRole("button", { name: /apply price/i }));

    expect(routerSpies.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/min price/i)).toHaveAccessibleDescription(/above the maximum/i);
  });

  it("keeps category out of the query string on category pages and offers clear-all", () => {
    const query = { ...DEFAULT_QUERY, category: "skillets", material: ["Cast iron"] };
    render(<FilterSidebar basePath="/c/skillets" query={query} facets={facets} omitCategory />);

    expect(screen.getByRole("link", { name: /clear all/i })).toHaveAttribute("href", "/c/skillets");
  });

  it("hides facet groups when facets are unavailable", () => {
    render(<FilterSidebar basePath="/shop" query={DEFAULT_QUERY} facets={null} />);
    expect(screen.queryByRole("group", { name: /brand/i })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /in stock only/i })).toBeInTheDocument();
  });
});
