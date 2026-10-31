import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { fail, type Cart } from "@hp/contracts";
import { makeCart, makeCartLine } from "@hp/test-utils";
import { axeViolations } from "@/test/axe";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { CartContents } from "./CartContents";

setupMockApi();

const line = makeCartLine({ productName: "Cast Iron Skillet", unitPriceCents: 5000 });
const plainCart = makeCart([line], { id: "cart_c" });
const couponCart = makeCart([line], { id: "cart_c", couponCode: "WELCOME5", discountCents: 500 });

const ok = (data: Cart) => HttpResponse.json({ success: true, data, error: null });

let current: Cart;
let bodies: unknown[];
let deletes: number;

beforeEach(() => {
  current = plainCart;
  bodies = [];
  deletes = 0;
  server.use(
    http.get(`${API_URL}/cart`, () => ok(current)),
    http.post(`${API_URL}/cart/coupon`, async ({ request }) => {
      const body = (await request.json()) as { code: string };
      bodies.push(body);
      if (body.code !== "WELCOME5") {
        return HttpResponse.json(fail("COUPON_INVALID", "That code isn't valid."), { status: 422 });
      }
      current = couponCart;
      return ok(current);
    }),
    http.delete(`${API_URL}/cart/coupon`, () => {
      deletes += 1;
      current = plainCart;
      return ok(current);
    }),
  );
});

/** The announcement must sit in a polite live region, not just appear on screen. */
const announced = async (text: RegExp) =>
  expect((await screen.findByText(text)).closest('[role="status"]')).not.toBeNull();

const codeInput = () => screen.getByRole("textbox", { name: /discount code/i });

describe("coupon form (D-05)", () => {
  it("applies a code and shows the server's discount", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartContents variant="page" />);
    await user.type(await screen.findByRole("textbox", { name: /discount code/i }), " welcome5 ");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await announced(/WELCOME5 applied/);
    expect(screen.getByText("Discount (WELCOME5)")).toBeInTheDocument();
    expect(screen.getByText(`−${shownMoney(500)}`)).toBeInTheDocument();
    expect(bodies).toEqual([{ code: "WELCOME5" }]);
  });

  it("does not post to the page URL if submitted before hydration", async () => {
    renderWithProviders(<CartContents variant="page" />);
    const form = (await screen.findByRole("textbox", { name: /discount code/i })).closest("form");
    expect(form).not.toHaveAttribute("method");
  });

  it("checks the code's format before calling the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartContents variant="page" />);
    await user.type(await screen.findByRole("textbox", { name: /discount code/i }), "x!");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(codeInput()).toHaveAttribute("aria-invalid", "true");
    expect(codeInput()).toHaveAccessibleDescription(/3–32 letters, numbers or hyphens/);
    expect(codeInput()).toHaveFocus();
    expect(bodies).toEqual([]);
  });

  it("shows the API's message for an invalid code, linked to the field", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<CartContents variant="page" />);
    await user.type(await screen.findByRole("textbox", { name: /discount code/i }), "NOPE-10");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(codeInput()).toHaveAccessibleDescription("That code isn't valid."));
    expect(codeInput()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/Discount \(/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the applied code with a way to remove it", async () => {
    const user = userEvent.setup();
    current = couponCart;
    const { container } = renderWithProviders(<CartContents variant="page" />);
    const remove = await screen.findByRole("button", { name: "Remove code WELCOME5" });
    expect(screen.queryByRole("textbox", { name: /discount code/i })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(remove);

    await announced(/Code removed/);
    expect(deletes).toBe(1);
    expect(screen.getByRole("textbox", { name: /discount code/i })).toBeInTheDocument();
    expect(screen.queryByText("Discount (WELCOME5)")).not.toBeInTheDocument();
  });

  it("reports a failed removal without losing the applied code", async () => {
    const user = userEvent.setup();
    current = couponCart;
    server.use(
      http.delete(`${API_URL}/cart/coupon`, () =>
        HttpResponse.json(fail("INTERNAL", "Try again."), { status: 500 }),
      ),
    );
    renderWithProviders(<CartContents variant="page" />);
    await user.click(await screen.findByRole("button", { name: "Remove code WELCOME5" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again.");
    expect(screen.getByText("Discount (WELCOME5)")).toBeInTheDocument();
  });
});
