import { screen } from "@testing-library/react";
import { renderWithProviders as render } from "@/test/render";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUERY } from "@/lib/query";
import { navigationMock, routerSpies } from "@/test/navigation";
import { Pagination } from "./Pagination";
import { SortSelect } from "./SortSelect";

vi.mock("next/navigation", () => navigationMock());

describe("SortSelect", () => {
  beforeEach(() => routerSpies.push.mockClear());

  it("pushes the chosen sort to the URL", async () => {
    const user = userEvent.setup();
    render(<SortSelect basePath="/shop" query={{ ...DEFAULT_QUERY, q: "pan" }} />);

    await user.selectOptions(screen.getByLabelText(/sort by/i), "price_asc");

    expect(routerSpies.push).toHaveBeenCalledWith("/shop?q=pan&sort=price_asc", { scroll: false });
  });
});

describe("Pagination", () => {
  it("renders nothing for a single page", () => {
    const { container } = render(
      <Pagination basePath="/shop" query={DEFAULT_QUERY} totalPages={1} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("marks the current page and links to neighbours", () => {
    render(<Pagination basePath="/shop" query={{ ...DEFAULT_QUERY, page: 2 }} totalPages={3} />);

    expect(screen.getByRole("navigation", { name: /pagination/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute("href", "/shop");
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute("href", "/shop?page=3");
  });

  it("omits previous on the first page and next on the last", () => {
    const { rerender } = render(
      <Pagination basePath="/shop" query={DEFAULT_QUERY} totalPages={2} />,
    );
    expect(screen.queryByRole("link", { name: /previous/i })).not.toBeInTheDocument();

    rerender(<Pagination basePath="/shop" query={{ ...DEFAULT_QUERY, page: 2 }} totalPages={2} />);
    expect(screen.queryByRole("link", { name: /next/i })).not.toBeInTheDocument();
  });
});
