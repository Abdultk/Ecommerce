import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, paged } from "@hp/contracts";
import { authStore } from "@/lib/auth-store";
import { navigationMock, routerSpies } from "@/test/navigation";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { signInMock } from "@/test/session";
import { AccountGuard } from "./AccountGuard";
import { AddressBook } from "./AddressBook";
import { OrderDetailView } from "./OrderDetailView";
import { OrderHistory } from "./OrderHistory";
import { ProfileForm } from "./ProfileForm";

vi.mock("next/navigation", () => ({
  ...navigationMock(),
  usePathname: () => "/account/orders",
}));
setupMockApi();

beforeEach(() => {
  authStore.reset();
  routerSpies.replace.mockClear();
});

describe("AccountGuard", () => {
  it("redirects signed-out shoppers to sign in, keeping where they were going", async () => {
    authStore.clear();
    renderWithProviders(
      <AccountGuard>
        <p>Secret</p>
      </AccountGuard>,
    );
    await waitFor(() =>
      expect(routerSpies.replace).toHaveBeenCalledWith("/login?next=%2Faccount%2Forders"),
    );
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  });

  it("waits for the session check before deciding", () => {
    renderWithProviders(
      <AccountGuard>
        <p>Secret</p>
      </AccountGuard>,
      undefined,
      { settleAuth: false },
    );
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });

  it("shows the account area when signed in", async () => {
    await signInMock();
    renderWithProviders(
      <AccountGuard>
        <p>Secret</p>
      </AccountGuard>,
    );
    expect(screen.getByText("Secret")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
  });
});

describe("OrderHistory", () => {
  it("lists paid orders newest first with status and total", async () => {
    await signInMock();
    renderWithProviders(<OrderHistory />);
    const rows = await screen.findAllByRole("link", { name: /HP-2026-00000\d/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("HP-2026-000004"),
      expect.stringContaining("HP-2026-000003"),
      expect.stringContaining("HP-2026-000002"),
      expect.stringContaining("HP-2026-000001"),
    ]);
    expect(rows[1]).toHaveAttribute("href", "/account/orders/HP-2026-000003");
    expect(screen.getByText("Shipped")).toBeInTheDocument();
  });

  it("pages through orders", async () => {
    const user = userEvent.setup();
    await signInMock();
    const pages: string[] = [];
    server.use(
      http.get(`${API_URL}/orders`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page"));
        pages.push(String(page));
        return HttpResponse.json(
          paged(
            [
              {
                id: `o_${page}`,
                number: `HP-2026-00010${page}`,
                status: "PAID",
                totalCents: 1000,
                itemCount: 1,
                createdAt: "2026-10-01T12:00:00.000Z",
                currency: "OMR",
                paymentMethod: "card",
                paymentLabel: null,
                paymentDueAt: null,
              },
            ],
            { page, pageSize: 10, total: 11 },
          ),
        );
      }),
    );
    renderWithProviders(<OrderHistory />);
    expect(await screen.findByText(/page 1 of 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText("HP-2026-000102")).toBeInTheDocument();
    expect(pages).toEqual(["1", "2"]);
  });

  it("lists a transfer awaiting payment with its own label and OMR total", async () => {
    await signInMock();
    renderWithProviders(<OrderHistory />);
    const row = (await screen.findByText("HP-2026-000004")).closest("a")!;
    expect(row).toHaveTextContent("Awaiting bank transfer");
    expect(row).toHaveTextContent(/OMR\s?\d+\.\d{3}/);
  });

  it("shows an empty state", async () => {
    await signInMock();
    server.use(
      http.get(`${API_URL}/orders`, () =>
        HttpResponse.json(paged([], { page: 1, pageSize: 10, total: 0 })),
      ),
    );
    renderWithProviders(<OrderHistory />);
    expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument();
  });
});

describe("OrderDetailView", () => {
  it("lets a customer cancel a paid order after typing the order number", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<OrderDetailView number="HP-2026-000003" />);

    await user.click(await screen.findByRole("button", { name: /cancel order/i }));
    const confirm = screen.getByRole("button", { name: /yes, cancel this order/i });
    expect(confirm).toBeDisabled();
    const input = screen.getByLabelText(/type HP-2026-000003 to confirm/i);
    expect(input).toHaveFocus();
    await user.type(input, "HP-2026-000003");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await screen.findByRole("status")).toHaveTextContent(/order cancelled/i);
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /cancel order/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^refunded in full: OMR\s?\d+\.\d{3}$/i)).toBeInTheDocument();
  });

  it("can back out of cancelling", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<OrderDetailView number="HP-2026-000003" />);
    const open = await screen.findByRole("button", { name: /cancel order/i });
    await user.click(open);
    await user.click(screen.getByRole("button", { name: /keep my order/i }));
    expect(screen.queryByLabelText(/to confirm/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel order/i })).toHaveFocus();
  });

  it("hides cancel once an order has shipped and shows the timeline and tracking", async () => {
    await signInMock();
    renderWithProviders(<OrderDetailView number="HP-2026-000002" />);
    expect(await screen.findByRole("heading", { name: /HP-2026-000002/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel order/i })).not.toBeInTheDocument();
    const timeline = screen.getByRole("list", { name: /order timeline/i });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("1Z999AA10123456791")).toBeInTheDocument();
  });

  it("shows a partial refund", async () => {
    await signInMock();
    renderWithProviders(<OrderDetailView number="HP-2026-000001" />);
    expect(await screen.findByText(`Partially refunded: ${shownMoney(1499)}`)).toBeInTheDocument();
    expect(screen.getByText(/Bawshar, Muscat 133/)).toBeInTheDocument();
    expect(screen.getByText("Paid by card")).toBeInTheDocument();
  });

  it("shows a transfer order as awaiting bank transfer with the bank details", async () => {
    await signInMock();
    renderWithProviders(<OrderDetailView number="HP-2026-000004" />);
    const panel = await screen.findByRole("region", { name: "Awaiting bank transfer" });
    expect(panel).toHaveTextContent("HP-2026-000004");
    expect(panel).toHaveTextContent(/OM51 0180/);
    expect(panel).toHaveTextContent(/Oct 13.*1:00.*GMT\+4/);
    expect(screen.getByText("Payment: bank transfer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel order/i })).toBeInTheDocument();
  });

  it("shows the API's conflict message if the order moved on meanwhile", async () => {
    const user = userEvent.setup();
    await signInMock();
    server.use(
      http.post(`${API_URL}/orders/:number/cancel`, () =>
        HttpResponse.json(fail("CONFLICT", "This order can no longer be cancelled."), {
          status: 409,
        }),
      ),
    );
    renderWithProviders(<OrderDetailView number="HP-2026-000003" />);
    await user.click(await screen.findByRole("button", { name: /cancel order/i }));
    await user.type(screen.getByLabelText(/to confirm/i), "HP-2026-000003");
    await user.click(screen.getByRole("button", { name: /yes, cancel this order/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer be cancelled/i);
  });

  it("shows not-found for someone else's order", async () => {
    await signInMock();
    renderWithProviders(<OrderDetailView number="HP-2026-000777" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't find that order/i);
  });
});

describe("AddressBook", () => {
  it("makes another address the default and unsets the old one", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<AddressBook />);

    const work = await screen.findByRole("article", { name: /Salalah Gardens/ });
    const home = screen.getByRole("article", { name: /Al Khuwair/ });
    expect(within(home).getByText(/Bawshar, Muscat 133/)).toBeInTheDocument();
    expect(within(work).getByText(/Salalah, Dhofar/)).toBeInTheDocument();
    expect(within(home).getByText("Default")).toBeInTheDocument();
    expect(within(work).queryByText("Default")).not.toBeInTheDocument();

    await user.click(within(work).getByRole("button", { name: /make default/i }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("article", { name: /Salalah Gardens/ })).getByText("Default"),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("article", { name: /Al Khuwair/ })).queryByText("Default"),
    ).not.toBeInTheDocument();
  });

  it("asks for an edit before making an old non-Omani address the default", async () => {
    const user = userEvent.setup();
    await signInMock();
    const legacy = {
      id: "addr_legacy",
      isDefault: false,
      fullName: "Ada Cook",
      line1: "1 Market St",
      line2: null,
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      country: "US",
      phone: null,
    };
    const writes: string[] = [];
    server.use(
      http.get(`${API_URL}/me/addresses`, () => HttpResponse.json(ok([legacy]))),
      http.patch(`${API_URL}/me/addresses/:id`, ({ params }) => {
        writes.push(String(params.id));
        return HttpResponse.json(fail("VALIDATION_ERROR", "Invalid."), { status: 422 });
      }),
    );
    renderWithProviders(<AddressBook />);
    const card = await screen.findByRole("article", { name: /1 Market St/ });
    await user.click(within(card).getByRole("button", { name: /make default/i }));
    expect(within(card).getByRole("alert")).toHaveTextContent(/missing omani details/i);
    expect(writes).toEqual([]);
  });

  it("adds an address after validating it", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<AddressBook />);
    await user.click(await screen.findByRole("button", { name: /add an address/i }));

    await user.click(screen.getByRole("button", { name: /save address/i }));
    expect(screen.getByLabelText("Full name")).toHaveAccessibleDescription("Required.");
    expect(screen.getByLabelText("Full name")).toHaveFocus();

    expect(screen.getByLabelText("Governorate")).toHaveAccessibleDescription(
      "Choose a governorate.",
    );
    expect(screen.getByLabelText("Mobile phone")).toHaveAttribute("aria-invalid", "true");

    await user.type(screen.getByLabelText("Full name"), "Ada Cook");
    await user.selectOptions(screen.getByLabelText("Governorate"), "Ad Dakhiliyah");
    await user.type(screen.getByLabelText("Wilayat"), "Nizwa");
    await user.type(screen.getByLabelText("Area and street"), "Firq, Street 7");
    await user.type(screen.getByLabelText("Mobile phone"), "9555 1234");
    await user.click(screen.getByRole("button", { name: /save address/i }));

    const saved = await screen.findByRole("article", { name: /Firq, Street 7/ });
    expect(saved).toHaveTextContent("Nizwa, Ad Dakhiliyah");
    expect(saved).toHaveTextContent("+96895551234");
  });

  it("edits and deletes an address", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<AddressBook />);
    const work = await screen.findByRole("article", { name: /Salalah Gardens/ });

    await user.click(within(work).getByRole("button", { name: /edit/i }));
    const city = screen.getByLabelText("Wilayat");
    await user.clear(city);
    await user.type(city, "Taqah");
    await user.click(screen.getByRole("button", { name: /save address/i }));
    const edited = await screen.findByRole("article", { name: /Salalah Gardens/ });
    await waitFor(() =>
      expect(
        within(edited).getByText("Taqah", { exact: false, selector: "address" }),
      ).toBeInTheDocument(),
    );

    await user.click(within(edited).getByRole("button", { name: /delete/i }));
    await user.click(within(edited).getByRole("button", { name: /yes, delete/i }));
    await waitFor(() =>
      expect(screen.queryByRole("article", { name: /Salalah Gardens/ })).not.toBeInTheDocument(),
    );
  });
});

describe("ProfileForm", () => {
  it("saves a new name and updates the signed-in user", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<ProfileForm />);
    const first = screen.getByLabelText("First name");
    expect(first).toHaveValue("Ada");
    await user.clear(first);
    await user.type(first, "Adelaide");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
    expect(authStore.getState().user?.firstName).toBe("Adelaide");
  });

  it("rejects an empty name", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<ProfileForm />);
    await user.clear(screen.getByLabelText("Last name"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(screen.getByLabelText("Last name")).toHaveAccessibleDescription("Required.");
  });
});
