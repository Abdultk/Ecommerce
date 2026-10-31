import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "@/lib/auth-store";
import { navigationMock } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";
import { setupMockApi } from "@/test/server";
import { signInMock } from "@/test/session";
import { Reviews } from "./Reviews";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

type User = ReturnType<typeof userEvent.setup>;

async function writeReview(user: User, rating = "4 stars") {
  await user.click(await screen.findByRole("button", { name: /write a review/i }));
  const group = screen.getByRole("radiogroup", { name: /your rating/i });
  await user.click(within(group).getByRole("radio", { name: rating }));
  await user.type(screen.getByLabelText("Title"), "Sears beautifully");
  await user.type(screen.getByLabelText("Review"), "Even heat and a great crust every time.");
  await user.click(screen.getByRole("button", { name: /post review/i }));
}

describe("Reviews", () => {
  beforeEach(() => authStore.clear());

  it("lists reviews with paging", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Reviews slug="cast-iron-skillet-10in" />);

    const list = await screen.findByRole("list", { name: /customer reviews/i });
    expect(within(list).getAllByRole("article")).toHaveLength(5);
    expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    expect(within(list).getAllByRole("img", { name: /rated \d out of 5/i })).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: /next reviews/i }));
    await waitFor(() => expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument());
    expect(
      within(screen.getByRole("list", { name: /customer reviews/i })).getAllByRole("article"),
    ).toHaveLength(2);
  });

  it("validates the form: rating is required and errors are linked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Reviews slug="cast-iron-skillet-10in" />);
    await user.click(await screen.findByRole("button", { name: /write a review/i }));
    await user.click(screen.getByRole("button", { name: /post review/i }));

    const group = screen.getByRole("radiogroup", { name: /your rating/i });
    expect(group).toHaveAccessibleDescription("Choose a rating from 1 to 5 stars.");
    expect(within(group).getByRole("radio", { name: "1 star" })).toHaveFocus();
    expect(screen.getByLabelText("Review")).toHaveAccessibleDescription(
      /Write at least 10 characters\./,
    );
  });

  it("asks signed-out shoppers to sign in (401)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Reviews slug="cast-iron-skillet-10in" />);
    await writeReview(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign in to write a review.");
    expect(within(alert).getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login?next=%2Fp%2Fcast-iron-skillet-10in",
    );
  });

  it("explains that only buyers can review (403)", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<Reviews slug="enameled-dutch-oven-5-5qt" />);
    await writeReview(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only customers who bought this product can review it.",
    );
  });

  it("explains a second review is not allowed (409)", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<Reviews slug="chefs-knife-8in" />);
    await writeReview(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've already reviewed this product.",
    );
  });

  it("posts a verified buyer's review and shows it first", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<Reviews slug="cast-iron-skillet-10in" />);
    await writeReview(user, "5 stars");

    expect(await screen.findByRole("status")).toHaveTextContent(/thanks/i);
    const list = await screen.findByRole("list", { name: /customer reviews/i });
    await waitFor(() =>
      expect(within(list).getAllByRole("article")[0]).toHaveTextContent("Sears beautifully"),
    );
    expect(within(list).getAllByRole("article")[0]).toHaveTextContent("Ada C.");
  });

  it("shows the API's error for an unknown product", async () => {
    renderWithProviders(<Reviews slug="no-such-product" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/product not found/i);
  });
});
