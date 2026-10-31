import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "@hp/contracts";
import { setCartNotice, takeCartNotice } from "@/lib/handoff";
import { navigationMock } from "@/test/navigation";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { addToMockCart } from "@/test/session";
import { CartContents } from "./CartContents";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

const skilletLine = () => screen.findByRole("listitem", { name: /cast iron skillet/i });

describe("cart quantity stepper and remove", () => {
  beforeEach(async () => {
    takeCartNotice();
    await addToMockCart("v_sample_01_1", 2);
  });

  it("updates the quantity through PATCH and shows the server's totals", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartContents variant="page" />);
    const line = await skilletLine();

    await user.click(within(line).getByRole("button", { name: /increase quantity of cast iron/i }));

    expect(within(line).getByText("3", { selector: "output" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(shownMoney(10_497)).length).toBeGreaterThan(0));
  });

  it("shows the change at once, then rolls back with the API's message", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API_URL}/cart/items/:id`, async () => {
        await delay(50);
        return HttpResponse.json(
          fail("OUT_OF_STOCK", 'Only 2 left of Cast Iron Skillet 10".', {
            variantId: "v_sample_01_1",
            available: 2,
          }),
          { status: 409 },
        );
      }),
    );
    renderWithProviders(<CartContents variant="page" />);
    const line = await skilletLine();

    await user.click(within(line).getByRole("button", { name: /increase quantity of cast iron/i }));
    // Optimistic: the new quantity shows before the server answers.
    expect(within(line).getByText("3", { selector: "output" })).toBeInTheDocument();

    expect(await within(line).findByRole("alert")).toHaveTextContent("Only 2 left");
    expect(within(line).getByText("2", { selector: "output" })).toBeInTheDocument();
  });

  it("disables decrease at 1 and removes the line", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartContents variant="page" />);
    const line = await skilletLine();
    await user.click(within(line).getByRole("button", { name: /decrease quantity of cast iron/i }));
    await waitFor(() =>
      expect(
        within(line).getByRole("button", { name: /decrease quantity of cast iron/i }),
      ).toBeDisabled(),
    );

    await user.click(within(line).getByRole("button", { name: /remove cast iron/i }));
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("puts a removed line back when the API refuses", async () => {
    const user = userEvent.setup();
    server.use(
      http.delete(`${API_URL}/cart/items/:id`, () =>
        HttpResponse.json(fail("INTERNAL", "The kitchen is closed."), { status: 500 }),
      ),
    );
    renderWithProviders(<CartContents variant="page" />);
    const line = await skilletLine();
    await user.click(within(line).getByRole("button", { name: /remove cast iron/i }));

    const restored = await skilletLine();
    expect(await within(restored).findByRole("alert")).toHaveTextContent("The kitchen is closed.");
  });

  it("shows a notice handed over from checkout once", async () => {
    setCartNotice('Only 1 left of Cast Iron Skillet 10".');
    renderWithProviders(<CartContents variant="page" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only 1 left");
    expect(takeCartNotice()).toBeNull();
  });
});
