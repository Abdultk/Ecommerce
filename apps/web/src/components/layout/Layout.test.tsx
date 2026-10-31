import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { makeCategoryTree } from "@hp/test-utils";
import { MOCK_STORE_CONFIG } from "@/test/msw/store";
import { authStore } from "@/lib/auth-store";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { setupMockApi } from "@/test/server";
import { Footer } from "./Footer";
import { Header } from "./Header";

setupMockApi();

const categories = makeCategoryTree();

describe("Header", () => {
  beforeEach(() => authStore.reset());

  it("renders the logo, search, category nav with sub-menus and the cart count", async () => {
    renderWithProviders(<Header categories={categories} storeConfig={MOCK_STORE_CONFIG} />);

    expect(screen.getByRole("link", { name: "PAISLEY art home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("searchbox", { name: /search products/i })).toHaveAttribute(
      "name",
      "q",
    );
    expect(screen.getByRole("search")).toHaveAttribute("action", "/shop");

    const nav = screen.getByRole("navigation", { name: /shop by category/i });
    expect(nav).toHaveTextContent("Cookware");
    expect(screen.getByRole("link", { name: "Dutch Ovens" })).toHaveAttribute(
      "href",
      "/c/dutch-ovens",
    );
    expect(await screen.findByRole("button", { name: "Cart, 0 items" })).toBeInTheDocument();
  });

  it("promises free shipping from the store's threshold, in its currency", () => {
    const { unmount } = renderWithProviders(
      <Header categories={[]} storeConfig={MOCK_STORE_CONFIG} />,
    );
    expect(
      screen.getByText(`Free shipping over ${shownMoney(30_000)}`, { exact: false }),
    ).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <Header
        categories={[]}
        storeConfig={{ ...MOCK_STORE_CONFIG, freeShippingThresholdCents: null }}
      />,
    );
    expect(screen.queryByText(/free shipping/i)).not.toBeInTheDocument();
    expect(screen.getByText(/delivery across oman/i)).toBeInTheDocument();
  });

  it("shows sign in when signed out, and the user's name with sign out when signed in", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Header categories={[]} storeConfig={MOCK_STORE_CONFIG} />);
    expect(screen.getAllByText("Sign in")[0]!.closest("a")).toHaveAttribute("href", "/login");

    act(() =>
      authStore.setSession({
        accessToken: "token",
        user: {
          id: "u1",
          email: "ada@example.test",
          firstName: "Ada",
          lastName: "Cook",
          role: "CUSTOMER",
          emailVerified: true,
        },
      }),
    );
    expect(screen.getByText("Hi, Ada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(authStore.getState().user).toBeNull());
    expect(authStore.getToken()).toBeNull();
  });
});

describe("Footer", () => {
  it("lists categories and help links, and names the store currency", () => {
    renderWithProviders(<Footer categories={categories} currency="OMR" />);
    expect(screen.getByText(/prices in omani rial/i)).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: /footer categories/i });
    expect(nav.querySelectorAll("a")).toHaveLength(categories.length);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(screen.getByRole("img", { name: "Visa" })).toBeInTheDocument();
  });
});

