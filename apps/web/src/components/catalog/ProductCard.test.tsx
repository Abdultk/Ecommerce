import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sampleCatalog, toSummary } from "@hp/test-utils";
import { navigationMock } from "@/test/navigation";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { ProductCard } from "./ProductCard";

vi.mock("next/navigation", () => navigationMock());

const [skillet, dutchOven, , , , , , scale] = sampleCatalog().map(toSummary);

describe("ProductCard", () => {
  it("links to the product page with name, brand and from-price", () => {
    renderWithProviders(<ProductCard product={skillet!} />);
    const link = screen.getByRole("link", { name: /^cast iron skillet/i });
    expect(screen.getByRole("link", { name: /sign in to save cast iron/i })).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/p/cast-iron-skillet-10in");
    expect(screen.getByText("Ironvale")).toBeInTheDocument();
    expect(screen.getByText(shownMoney(3_499))).toBeInTheDocument();
    expect(screen.getByText(/from/i)).toBeInTheDocument();
  });

  it("describes the rating for screen readers", () => {
    renderWithProviders(<ProductCard product={skillet!} />);
    expect(
      screen.getByRole("img", { name: "Rated 4.8 out of 5 from 1,290 reviews" }),
    ).toBeInTheDocument();
  });

  it("flags sold-out products", () => {
    renderWithProviders(<ProductCard product={scale!} />);
    expect(screen.getByText(/sold out/i)).toBeInTheDocument();
  });

  it("does not flag in-stock products", () => {
    renderWithProviders(<ProductCard product={dutchOven!} />);
    expect(screen.queryByText(/sold out/i)).not.toBeInTheDocument();
  });
});
