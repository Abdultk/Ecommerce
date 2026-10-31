import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@hp/contracts";
import { sampleCatalog, toSummary } from "@hp/test-utils";
import { authStore } from "@/lib/auth-store";
import { navigationMock } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { signInMock } from "@/test/session";
import { WishlistButton } from "./WishlistButton";
import { WishlistView } from "./WishlistView";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

const [skillet, dutchOven] = sampleCatalog().map(toSummary);

beforeEach(() => authStore.clear());

describe("WishlistButton", () => {
  it("sends signed-out shoppers to sign in", () => {
    renderWithProviders(<WishlistButton product={skillet!} />);
    expect(
      screen.getByRole("link", { name: /sign in to save cast iron skillet/i }),
    ).toHaveAttribute("href", "/login?next=%2Fshop");
  });

  it("toggles a product in and out of the wishlist", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<WishlistButton product={skillet!} />);
    const heart = await screen.findByRole("button", { name: /save cast iron skillet/i });
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "false"));

    await user.click(heart);
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "true"));
    await user.click(heart);
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "false"));
  });

  it("shows a seeded item as saved", async () => {
    await signInMock();
    renderWithProviders(<WishlistButton product={dutchOven!} />);
    const heart = await screen.findByRole("button", { name: /save enameled dutch oven/i });
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "true"));
  });

  it("rolls back and explains when saving fails", async () => {
    const user = userEvent.setup();
    await signInMock();
    server.use(
      http.post(`${API_URL}/me/wishlist`, () =>
        HttpResponse.json(fail("INTERNAL", "Wishlist is resting."), { status: 500 }),
      ),
    );
    renderWithProviders(<WishlistButton product={skillet!} />);
    const heart = await screen.findByRole("button", { name: /save cast iron skillet/i });
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "false"));
    await user.click(heart);

    expect(await screen.findByRole("alert")).toHaveTextContent("Wishlist is resting.");
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "false"));
  });
});

describe("WishlistView", () => {
  it("lists saved products and removes one", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<WishlistView />);

    expect(await screen.findByRole("link", { name: /enameled dutch oven/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save enameled dutch oven/i }));

    expect(await screen.findByText(/nothing saved yet/i)).toBeInTheDocument();
  });

  it("shows the summaries the wishlist products endpoint returns", async () => {
    await signInMock();
    server.use(
      http.get(`${API_URL}/me/wishlist/products`, () => HttpResponse.json(ok([skillet!]))),
    );
    renderWithProviders(<WishlistView />);

    expect(await screen.findByRole("link", { name: /cast iron skillet/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /enameled dutch oven/i })).not.toBeInTheDocument();
  });
});
