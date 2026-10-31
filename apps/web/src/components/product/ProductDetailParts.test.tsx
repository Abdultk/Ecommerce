import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders as render } from "@/test/render";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { sampleCatalog } from "@hp/test-utils";
import { ProductImage } from "@/components/catalog/ProductImage";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { axeViolations } from "@/test/axe";
import { Gallery } from "./Gallery";
import { SpecsTable } from "./SpecsTable";

const [skillet, , saucepan, knife] = sampleCatalog();

describe("SpecsTable", () => {
  it("lists material, oven-safe temperature in °F and °C, induction, dishwasher and care", () => {
    render(<SpecsTable product={skillet!} />);
    const row = (name: string) => screen.getByRole("rowheader", { name }).closest("tr")!;

    expect(screen.getByRole("table", { name: /product details/i })).toBeInTheDocument();
    expect(row("Material")).toHaveTextContent("Cast iron");
    expect(row("Oven-safe")).toHaveTextContent("Up to 500°F (260°C)");
    expect(row("Induction")).toHaveTextContent("Works on induction");
    expect(row("Dishwasher")).toHaveTextContent("Hand wash only");
    expect(row("Care")).toHaveTextContent(/oil lightly/);
  });

  it("handles unknown and not-applicable specs", () => {
    render(<SpecsTable product={{ ...knife!, careInstructions: null, material: null }} />);
    const row = (name: string) => screen.getByRole("rowheader", { name }).closest("tr")!;
    expect(row("Oven-safe")).toHaveTextContent(/not oven-safe/i);
    expect(row("Induction")).toHaveTextContent("Not listed");
    expect(row("Material")).toHaveTextContent("Not listed");
    expect(row("Care")).toHaveTextContent("Not listed");
  });

  it("shows dishwasher-safe items positively", () => {
    render(<SpecsTable product={saucepan!} />);
    expect(screen.getByText("Dishwasher safe")).toBeInTheDocument();
  });
});

describe("Gallery", () => {
  const images = [
    { id: "img_b", url: "https://cdn.example.test/b.webp", alt: "Side view", position: 1 },
    { id: "img_a", url: "https://cdn.example.test/a.webp", alt: "Top view", position: 0 },
  ];

  it("shows images in position order and switches with thumbnails", async () => {
    const user = userEvent.setup();
    render(<Gallery images={images} productName="Pan" />);

    expect(screen.getByRole("img", { name: "Top view" })).toBeInTheDocument();
    const second = screen.getByRole("button", { name: "Show image 2 of 2" });
    await user.click(second);

    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Side view" })).toBeInTheDocument();
  });

  it("has no thumbnail strip for a single image", () => {
    render(<Gallery images={images.slice(0, 1)} productName="Pan" />);
    expect(screen.queryByRole("list", { name: /product images/i })).not.toBeInTheDocument();
  });
});

describe("ProductImage", () => {
  it("falls back to a drawn placeholder when the image fails", () => {
    render(
      <div className="relative">
        <ProductImage src="https://cdn.example.test/missing.webp" alt="Skillet" sizes="100px" />
      </div>,
    );
    fireEvent.error(screen.getByRole("img", { name: "Skillet" }));
    expect(screen.getByRole("img", { name: "Skillet" }).tagName).toBe("DIV");
  });

  it("renders the placeholder when there is no image", () => {
    render(<ProductImage src={null} alt="No photo" sizes="100px" />);
    expect(screen.getByRole("img", { name: "No photo" }).tagName).toBe("DIV");
  });

  it("renders a decorative placeholder (hidden, no img role) when alt is empty (D-06)", async () => {
    const { container } = render(<ProductImage src={null} alt="" sizes="100px" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const placeholder = container.firstElementChild!;
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).not.toHaveAttribute("role");
    expect(placeholder).not.toHaveAttribute("aria-label");
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Breadcrumbs", () => {
  it("links every crumb but the current page", () => {
    render(
      <Breadcrumbs
        items={[
          { name: "Home", href: "/" },
          { name: "Skillets", href: "/c/skillets" },
          { name: "Skillet 10", href: "/p/skillet" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Skillets" })).toHaveAttribute("href", "/c/skillets");
    expect(screen.getByText("Skillet 10")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Skillet 10" })).not.toBeInTheDocument();
  });
});
