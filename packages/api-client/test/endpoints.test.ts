import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { fail, ok } from "@hp/contracts";
import { createApiClient } from "../src/index";
import { createEndpoints } from "../src/endpoints";

const BASE = "http://api.test/api/v1";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NOW = "2026-10-13T08:00:00Z";
const bank = {
  bankName: "Bank Muscat",
  accountName: "Hearth & Pan LLC",
  accountNumber: "0123456789",
  iban: "OM590180000000123456789",
};
const settings = {
  storeName: "Hearth & Pan",
  currency: "OMR",
  vatRateBps: 500,
  shipping: {
    standardCents: 2000,
    expressCents: 5000,
    freeShippingThresholdCents: 30_000,
    standardDays: { min: 2, max: 4 },
    expressDays: { min: 1, max: 1 },
  },
  payments: {
    cardEnabled: true,
    bankTransferEnabled: true,
    bankTransferHoldHours: 24,
    manualMethods: [],
    bank,
  },
  updatedAt: NOW,
};
const profile = {
  id: "u1",
  email: "admin@example.om",
  firstName: "Aisha",
  lastName: "Al Balushi",
  role: "ADMIN",
  emailVerified: true,
  totpEnabledAt: NOW,
};
const totals = {
  subtotalCents: 1000,
  discountCents: 0,
  shippingCents: 0,
  taxCents: 0,
  totalCents: 1000,
};
const adminOrder = {
  order: {
    id: "o1",
    number: "HP-2026-000001",
    status: "PAID",
    totalCents: 1000,
    itemCount: 1,
    createdAt: NOW,
    currency: "OMR",
    paymentMethod: "bank_transfer",
    paymentLabel: null,
    paymentDueAt: null,
    email: "s@example.om",
    items: [
      {
        id: "i1",
        variantId: "v1",
        productName: "P",
        variantName: "V",
        sku: "S-1",
        unitPriceCents: 1000,
        quantity: 1,
        lineTotalCents: 1000,
      },
    ],
    totals,
    refundedCents: 0,
    refundState: "NONE",
    shippingAddress: {
      fullName: "S",
      line1: "Al Khuwair",
      city: "Bawshar",
      region: "MA",
      country: "OM",
      phone: "+96891234567",
    },
    shippingMethod: "standard",
    trackingNumber: null,
    carrier: null,
    estimatedDeliveryAt: null,
    couponCode: null,
    paidAt: NOW,
    events: [],
    bankTransfer: null,
    manualPayment: null,
  },
  customer: null,
  paymentIntentId: null,
  paymentProvider: "manual",
  transferBankReference: "FT1",
  transferConfirmedByEmail: "admin@example.om",
  refunds: [],
  allowedStatuses: ["PROCESSING"],
  canCancel: true,
  refundableCents: 1000,
};

type Seen = { method: string; path: string; body: unknown; key: string | null };

/** Records every request and answers with the given payload. */
function capture(payload: unknown, status = 200): Seen[] {
  const seen: Seen[] = [];
  server.use(
    http.all(`${BASE}/*`, async ({ request }) => {
      const text = await request.text();
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname.replace("/api/v1", ""),
        body: text ? JSON.parse(text) : undefined,
        key: request.headers.get("Idempotency-Key"),
      });
      return HttpResponse.json(ok(payload), { status });
    }),
  );
  return seen;
}

const api = () => createEndpoints(createApiClient(BASE));

describe("storefront endpoints", () => {
  it("GET /store", async () => {
    const config = {
      storeName: "Hearth & Pan",
      currency: "OMR",
      vatRateBps: 500,
      freeShippingThresholdCents: 30_000,
      paymentMethods: ["card"],
      manualMethods: [],
    };
    const seen = capture(config);
    expect((await api().store.get()).data).toEqual(config);
    expect(seen[0]).toMatchObject({ method: "GET", path: "/store" });
  });

  it("POST /checkout/status", async () => {
    const seen = capture({ status: "PAID" });
    const input = { number: "HP-2026-000001", token: "t".repeat(32) };
    expect((await api().checkout.status(input)).data.status).toBe("PAID");
    expect(seen[0]).toMatchObject({ method: "POST", path: "/checkout/status", body: input });
  });
});

describe("admin settings endpoints", () => {
  it("reads settings", async () => {
    const seen = capture(settings);
    expect((await api().adminSettings.get()).data.currency).toBe("OMR");
    expect(seen[0]).toMatchObject({ method: "GET", path: "/admin/settings" });
  });

  it.each([
    ["patchGeneral", "/admin/settings/general", { vatRateBps: 0 }],
    ["patchShipping", "/admin/settings/shipping", { expressCents: 4000 }],
    ["patchPayments", "/admin/settings/payments", { bank, totpCode: "123456" }],
  ] as const)("%s PATCHes %s", async (method, path, body) => {
    const seen = capture(settings);
    const { data } = await api().adminSettings[method](body as never);
    expect(data.storeName).toBe("Hearth & Pan");
    expect(seen[0]).toMatchObject({ method: "PATCH", path, body });
  });

  it("PUTs a currency change and surfaces CURRENCY_LOCKED", async () => {
    const body = { currency: "USD", confirm: "USD", totpCode: "123456" } as const;
    const seen = capture({ ...settings, currency: "USD" });
    expect((await api().adminSettings.changeCurrency(body)).data.currency).toBe("USD");
    expect(seen[0]).toMatchObject({ method: "PUT", path: "/admin/settings/currency", body });

    server.use(
      http.put(`${BASE}/admin/settings/currency`, () =>
        HttpResponse.json(fail("CURRENCY_LOCKED", "Orders exist."), { status: 409 }),
      ),
    );
    await expect(api().adminSettings.changeCurrency(body)).rejects.toMatchObject({
      status: 409,
      code: "CURRENCY_LOCKED",
    });
  });
});

describe("admin account endpoints", () => {
  it("sends a password reset for a user (id is URL-encoded)", async () => {
    const seen = capture({ sent: true });
    const { data } = await api().adminUsers.sendPasswordReset("u/1", { resetTwoFactor: true });
    expect(data.sent).toBe(true);
    expect(seen[0]).toMatchObject({
      method: "POST",
      path: "/admin/users/u%2F1/password-reset",
      body: { resetTwoFactor: true },
    });
  });

  it("resets a staff password with a token", async () => {
    const seen = capture(null);
    const body = { token: "t".repeat(32), password: "a long enough passphrase" };
    expect((await api().adminAuth.resetPassword(body)).data).toBeNull();
    expect(seen[0]).toMatchObject({ method: "POST", path: "/admin/auth/reset-password", body });
  });

  it("reads and updates the admin profile", async () => {
    const seen = capture(profile);
    expect((await api().adminMe.get()).data.totpEnabledAt).toBe(NOW);
    await api().adminMe.update({ firstName: "Aisha" });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /admin/me", "PATCH /admin/me"]);
  });

  it("changes the password and revokes other sessions", async () => {
    const seen = capture(null);
    const body = { currentPassword: "old", newPassword: "a brand new passphrase", totpCode: "1" };
    await api().adminMe.changePassword(body);
    await api().adminMe.revokeOtherSessions();
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "POST /admin/me/password",
      "POST /admin/me/sessions/revoke-others",
    ]);
    expect(seen[0]?.body).toEqual(body);
  });
});

describe("admin order endpoints", () => {
  it("confirms a transfer with an Idempotency-Key", async () => {
    const seen = capture(adminOrder);
    const body = { receivedCents: 1000, bankReference: "FT1" };
    const { data } = await api().adminOrders.confirmTransfer("o1", body, "key-1");
    expect(data.transferBankReference).toBe("FT1");
    expect(seen[0]).toMatchObject({
      method: "POST",
      path: "/admin/orders/o1/confirm-transfer",
      body,
      key: "key-1",
    });
  });

  it("rejects a malformed response", async () => {
    capture({ ...adminOrder, paymentProvider: "paypal" });
    await expect(
      api().adminOrders.confirmTransfer("o1", { receivedCents: 1, bankReference: "x" }, "k"),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
