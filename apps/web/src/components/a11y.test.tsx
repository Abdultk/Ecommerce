import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductDetail } from "@hp/contracts";
import { makeCategoryTree, sampleCatalog, toSummary } from "@hp/test-utils";
import { authStore } from "@/lib/auth-store";
import { DEFAULT_QUERY } from "@/lib/query";
import { axeViolations } from "@/test/axe";
import { navigationMock } from "@/test/navigation";
import { MOCK_STORE_CONFIG } from "@/test/msw/store";
import { renderWithProviders } from "@/test/render";
import { setupMockApi } from "@/test/server";
import { addToMockCart } from "@/test/session";
import { LoginForm } from "./auth/LoginForm";
import { RegisterForm } from "./auth/RegisterForm";
import { CartButton } from "./cart/CartButton";
import { CartDrawer } from "./cart/CartDrawer";
import { ListingView } from "./catalog/ListingView";
import { CheckoutFlow } from "./checkout/CheckoutFlow";
import { Breadcrumbs } from "./layout/Breadcrumbs";
import { Footer } from "./layout/Footer";
import { Header } from "./layout/Header";
import { Gallery } from "./product/Gallery";
import { ProductPurchase } from "./product/ProductPurchase";
import { Reviews } from "./product/Reviews";
import { SpecsTable } from "./product/SpecsTable";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

const categories = makeCategoryTree();
const product = ProductDetail.parse(sampleCatalog()[1]);

beforeEach(() => authStore.reset());

describe("accessibility (axe, WCAG 2.2 AA rules)", () => {
  it("control: the audit does report real problems", async () => {
    const { container } = renderWithProviders(
      <form>
        <input type="text" />
        <button type="button" />
      </form>,
    );
    const violations = await axeViolations(container);
    expect(violations.join("\n")).toMatch(/label/);
    expect(violations.join("\n")).toMatch(/button-name/);
  });

  it("page chrome: header, main, footer and breadcrumbs", async () => {
    const { container } = renderWithProviders(
      <>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Header categories={categories} storeConfig={MOCK_STORE_CONFIG} />
        <main id="main" tabIndex={-1}>
          <Breadcrumbs
            items={[
              { name: "Home", href: "/" },
              { name: "Skillets", href: "/c/skillets" },
            ]}
          />
          <h1>Skillets</h1>
        </main>
        <Footer categories={categories} currency="OMR" />
      </>,
    );
    await screen.findByRole("button", { name: /^cart,/i });
    expect(await axeViolations(container, { page: true })).toEqual([]);
  });

  it("listing: filters, sort, product cards and pagination", async () => {
    const products = sampleCatalog().map(toSummary);
    const { container } = renderWithProviders(
      <ListingView
        eyebrow="All"
        heading="Shop all"
        basePath="/shop"
        query={{ ...DEFAULT_QUERY, q: "pan" }}
        result={{
          products: products.slice(0, 4),
          meta: { page: 1, pageSize: 4, total: 8, totalPages: 2 },
        }}
        facets={
          {
            brands: [{ value: "Ironvale", count: 2 }],
            materials: [{ value: "cast_iron", count: 2 }],
            priceRange: { minCents: 1000, maxCents: 30000 },
          } as never
        }
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("product detail: gallery, purchase box, specs and reviews", async () => {
    const { container } = renderWithProviders(
      <article>
        <h1>{product.name}</h1>
        <Gallery images={product.images} productName={product.name} />
        <ProductPurchase product={product} />
        <SpecsTable product={product} />
        <Reviews slug={product.slug} />
      </article>,
    );
    await screen.findByRole("heading", { name: /reviews/i });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the open cart drawer", async () => {
    const user = userEvent.setup();
    await addToMockCart("v_sample_04_1", 1);
    renderWithProviders(
      <>
        <CartButton />
        <CartDrawer />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /^cart,/i }));
    const dialog = screen.getByRole("dialog", { name: "Your cart" });
    await screen.findByRole("list", { name: /items in your cart/i });
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("checkout address step showing validation errors", async () => {
    const user = userEvent.setup();
    authStore.clear(); // signed-out guest whose session check has finished
    await addToMockCart("v_sample_04_1", 1);
    const { container } = renderWithProviders(<CheckoutFlow />);
    await user.click(await screen.findByRole("button", { name: /continue to shipping/i }));
    await waitFor(() =>
      expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("sign-in and registration forms with errors", async () => {
    const user = userEvent.setup();
    const login = renderWithProviders(<LoginForm />);
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await axeViolations(login.container)).toEqual([]);
    login.unmount();

    const register = renderWithProviders(<RegisterForm />);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await axeViolations(register.container)).toEqual([]);
  });
});
