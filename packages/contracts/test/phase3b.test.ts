import { describe, expect, it } from "vitest";
import {
  AdminOrderDetail,
  AdminOrderListItem,
  AdminOrderQuery,
  AnalyticsSummary,
  ConfirmTransferInput,
  RefundInput,
} from "../src/admin";
import {
  AdminPasswordResetInput,
  AdminProfile,
  AdminResetPasswordInput,
  ChangePasswordInput,
  PasswordResetSent,
} from "../src/auth";
import { Cart } from "../src/cart";
import { ERROR_CODES, ERROR_HTTP_STATUS } from "../src/envelope";
import {
  CheckoutInput,
  CheckoutIntent,
  CheckoutPayment,
  CheckoutStatus,
  CheckoutStatusInput,
  OMAN_GOVERNORATES,
  OmanPhone,
  OrderDetail,
  OrderSummary,
  ShippingAddress,
  StoredAddress,
} from "../src/orders";
import { Address, AddressInput } from "../src/user";

const NOW = "2026-10-13T08:00:00Z";
const DUE = "2026-10-14T08:00:00Z";
const NUMBER = "HP-2026-000042";

const bank = {
  bankName: "Bank Muscat",
  accountName: "Hearth & Pan LLC",
  accountNumber: "0123456789",
  iban: "OM590180000000123456789",
};

const address = {
  fullName: "Salim Al Harthy",
  line1: "Al Khuwair, Way 3021",
  line2: "Building 12, Flat 4",
  city: "Bawshar",
  region: "ma",
  postalCode: "133",
  country: "OM",
  phone: "9123 4567",
};

const totals = {
  subtotalCents: 18_500,
  discountCents: 0,
  shippingCents: 2000,
  taxCents: 925,
  totalCents: 21_425,
};

describe("OMAN_GOVERNORATES", () => {
  it("lists the eleven ISO 3166-2:OM governorates", () => {
    expect(OMAN_GOVERNORATES.map((g) => g.code).sort()).toEqual(
      ["BJ", "BS", "BU", "DA", "MA", "MU", "SJ", "SS", "WU", "ZA", "ZU"].sort(),
    );
    expect(OMAN_GOVERNORATES.find((g) => g.code === "MA")?.name).toBe("Muscat");
  });
});

describe("OmanPhone", () => {
  it.each([
    "9123 4567",
    "91234567",
    "+968 9123 4567",
    "+96891234567",
    "00968 91234567",
    "968 9123 4567",
    "(+968) 9123-4567",
  ])("normalises %s to +968XXXXXXXX", (input) => {
    expect(OmanPhone.parse(input)).toBe("+96891234567");
  });

  it("accepts landlines starting with 2 and mobiles starting with 7", () => {
    expect(OmanPhone.parse("2456 7890")).toBe("+96824567890");
    expect(OmanPhone.parse("7123 4567")).toBe("+96871234567");
  });

  it.each([
    ["too short", "9123 456"],
    ["too long", "9123 45678"],
    ["another country code", "+971 50 123 4567"],
    ["a bad leading digit", "5123 4567"],
    ["letters", "9123 abcd"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(OmanPhone.safeParse(input).success).toBe(false);
  });
});

describe("ShippingAddress (Oman)", () => {
  it("normalises governorate and phone", () => {
    const parsed = ShippingAddress.parse(address);
    expect(parsed.region).toBe("MA");
    expect(parsed.phone).toBe("+96891234567");
  });

  it("makes the postal code optional and treats blank as absent", () => {
    const { postalCode: _p, ...rest } = address;
    expect(ShippingAddress.parse(rest).postalCode).toBeUndefined();
    expect(ShippingAddress.parse({ ...address, postalCode: " " }).postalCode).toBeUndefined();
  });

  it.each([
    ["an unknown governorate", { region: "CA" }],
    ["a US ZIP code", { postalCode: "94105" }],
    ["another country", { country: "US" }],
    ["a missing phone", { phone: undefined }],
    ["a missing wilayat", { city: " " }],
  ])("rejects %s", (_label, patch) => {
    expect(ShippingAddress.safeParse({ ...address, ...patch }).success).toBe(false);
  });
});

describe("StoredAddress (read model)", () => {
  it("still parses an older US-shaped address", () => {
    const us = {
      fullName: "Ada Cook",
      line1: "1 Market St",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      country: "US",
    };
    expect(StoredAddress.parse(us).country).toBe("US");
  });

  it("parses user addresses through the lenient model", () => {
    expect(Address.parse({ ...address, id: "a1", isDefault: true }).region).toBe("ma");
    expect(AddressInput.parse(address).isDefault).toBe(false);
  });
});

describe("checkout payments", () => {
  it("requires a payment method on checkout", () => {
    const base = { email: "s@example.om", shippingAddress: address, shippingMethod: "standard" };
    expect(CheckoutInput.safeParse(base).success).toBe(false);
    expect(CheckoutInput.parse({ ...base, paymentMethod: "bank_transfer" }).paymentMethod).toBe(
      "bank_transfer",
    );
    expect(CheckoutInput.safeParse({ ...base, paymentMethod: "cash" }).success).toBe(false);
  });

  const transfer = {
    kind: "bank_transfer",
    reference: NUMBER,
    amountCents: 21_425,
    currency: "OMR",
    dueAt: DUE,
    bank,
  };

  it.each([
    { kind: "redirect", provider: "amwal", redirectUrl: "https://api.example.com/api/v1/checkout/amwal-pay/x" },
    { kind: "redirect", provider: "fake", redirectUrl: "http://localhost:3000/dev/pay" },
    { kind: "client_secret", provider: "stripe", clientSecret: "pi_1_secret_2" },
    transfer,
  ])("parses a $kind payment", (payment) => {
    expect(CheckoutPayment.parse(payment).kind).toBe(payment.kind);
  });

  it.each([
    [
      "a javascript: redirect",
      { kind: "redirect", provider: "amwal", redirectUrl: "javascript:x" },
    ],
    [
      "stripe as a redirect",
      { kind: "redirect", provider: "stripe", redirectUrl: "https://x.test" },
    ],
    ["amwal with a secret", { kind: "client_secret", provider: "amwal", clientSecret: "s" }],
    ["an unknown kind", { kind: "cash" }],
    ["a transfer without bank", { ...transfer, bank: undefined }],
  ])("rejects %s", (_label, payment) => {
    expect(CheckoutPayment.safeParse(payment).success).toBe(false);
  });

  const intent = {
    orderNumber: NUMBER,
    lookupToken: "t".repeat(32),
    totals,
    currency: "OMR",
    payment: transfer,
  };

  it("parses a checkout intent", () => {
    expect(CheckoutIntent.parse(intent).payment.kind).toBe("bank_transfer");
  });

  it.each([
    ["amount", { amountCents: 1 }],
    ["currency", { currency: "USD" }],
    ["reference", { reference: "HP-2026-000043" }],
  ])("rejects a transfer whose %s disagrees with the order", (_label, patch) => {
    const bad = { ...intent, payment: { ...transfer, ...patch } };
    expect(CheckoutIntent.safeParse(bad).success).toBe(false);
  });

  it("parses the status poll input and result", () => {
    expect(CheckoutStatusInput.parse({ number: NUMBER }).token).toBeUndefined();
    expect(CheckoutStatusInput.safeParse({ number: NUMBER, token: "short" }).success).toBe(false);
    expect(CheckoutStatus.parse({ status: "PAID" }).status).toBe("PAID");
  });
});

const item = {
  id: "i1",
  variantId: "v1",
  productName: "Skillet",
  variantName: "26 cm",
  sku: "SK-26",
  unitPriceCents: 18_500,
  quantity: 1,
  lineTotalCents: 18_500,
};

const order = {
  id: "o1",
  number: NUMBER,
  status: "PENDING_PAYMENT",
  totalCents: 21_425,
  itemCount: 1,
  createdAt: NOW,
  currency: "OMR",
  paymentMethod: "bank_transfer",
  paymentLabel: null,
  paymentDueAt: DUE,
  email: "s@example.om",
  items: [item],
  totals,
  refundedCents: 0,
  refundState: "NONE",
  shippingAddress: address,
  shippingMethod: "standard",
  trackingNumber: null,
  carrier: null,
  estimatedDeliveryAt: null,
  couponCode: null,
  paidAt: null,
  events: [],
  bankTransfer: { reference: NUMBER, amountCents: 21_425, dueAt: DUE, bank },
  manualPayment: null,
};

describe("orders with currency and payment method", () => {
  it("parses a summary", () => {
    const { currency, paymentMethod, paymentDueAt } = OrderSummary.parse(order);
    expect({ currency, paymentMethod, paymentDueAt }).toEqual({
      currency: "OMR",
      paymentMethod: "bank_transfer",
      paymentDueAt: DUE,
    });
  });

  it("parses a pending transfer order with its bank details", () => {
    expect(OrderDetail.parse(order).bankTransfer?.reference).toBe(NUMBER);
  });

  it("allows no transfer details on a paid card order", () => {
    const card = {
      ...order,
      status: "PAID",
      paymentMethod: "card",
      paymentDueAt: null,
      paidAt: NOW,
      bankTransfer: null,
      manualPayment: null,
    };
    expect(OrderDetail.parse(card).bankTransfer).toBeNull();
  });

  it.each([
    [
      "a subtotal that ignores the items",
      { items: [{ ...item, quantity: 2, lineTotalCents: 37_000 }], itemCount: 2 },
    ],
    ["a refund state that disagrees", { refundState: "PARTIAL" }],
  ])("rejects %s", (_label, patch) => {
    expect(OrderDetail.safeParse({ ...order, ...patch }).success).toBe(false);
  });

  it.each([
    ["on a card order", { paymentMethod: "card" }],
    ["once paid", { status: "PAID", paidAt: NOW }],
    ["with the wrong amount", { bankTransfer: { ...order.bankTransfer, amountCents: 1 } }],
    [
      "with another reference",
      { bankTransfer: { ...order.bankTransfer, reference: "HP-2026-000043" } },
    ],
  ])("rejects transfer details %s", (_label, patch) => {
    expect(OrderDetail.safeParse({ ...order, ...patch }).success).toBe(false);
  });
});

describe("admin order additions", () => {
  it("parses a list row with payment info", () => {
    const row = AdminOrderListItem.parse({
      id: "o1",
      number: NUMBER,
      status: "PENDING_PAYMENT",
      email: "s@example.om",
      customerName: null,
      itemCount: 1,
      totalCents: 21_425,
      refundedCents: 0,
      createdAt: NOW,
      paidAt: null,
      currency: "OMR",
      paymentMethod: "bank_transfer",
      paymentLabel: null,
      paymentDueAt: DUE,
    });
    expect(row.paymentMethod).toBe("bank_transfer");
  });

  it("filters orders by payment method", () => {
    expect(AdminOrderQuery.parse({ paymentMethod: "card" }).paymentMethod).toBe("card");
    expect(AdminOrderQuery.safeParse({ paymentMethod: "cash" }).success).toBe(false);
  });

  it("parses the detail with provider and transfer fields", () => {
    const detail = AdminOrderDetail.parse({
      order: {
        ...order,
        status: "PAID",
        paidAt: NOW,
        paymentDueAt: null,
        bankTransfer: null,
        manualPayment: null,
      },
      customer: null,
      paymentIntentId: null,
      paymentProvider: "manual",
      transferBankReference: "FT2601234",
      transferConfirmedByEmail: "admin@example.om",
      refunds: [
        {
          id: "r1",
          amountCents: 1000,
          reason: null,
          actorEmail: "admin@example.om",
          createdAt: NOW,
          provider: "manual",
          bankReference: "FT2609999",
        },
      ],
      allowedStatuses: ["PROCESSING"],
      canCancel: true,
      refundableCents: 20_425,
    });
    expect(detail.refunds[0]?.bankReference).toBe("FT2609999");
  });

  it("validates a transfer confirmation", () => {
    const input = { receivedCents: 21_425, bankReference: " FT2601234 " };
    expect(ConfirmTransferInput.parse(input).bankReference).toBe("FT2601234");
    expect(ConfirmTransferInput.safeParse({ ...input, bankReference: "" }).success).toBe(false);
    expect(ConfirmTransferInput.safeParse({ ...input, receivedCents: 0 }).success).toBe(false);
  });

  it("lets a refund carry a bank reference", () => {
    expect(RefundInput.parse({ amountCents: 100, bankReference: "FT1" }).bankReference).toBe("FT1");
    expect(RefundInput.parse({ amountCents: 100 }).bankReference).toBeUndefined();
  });

  it("reports analytics in the store currency", () => {
    const kpis = {
      revenueCents: 0,
      orders: 0,
      aovCents: 0,
      refundRate: 0,
      newCustomers: 0,
      returningCustomers: 0,
      grossMarginCents: null,
      lowStockSkus: 0,
    };
    expect(
      AnalyticsSummary.parse({ current: kpis, previous: kpis, currency: "OMR" }).currency,
    ).toBe("OMR");
    expect(AnalyticsSummary.safeParse({ current: kpis, previous: kpis }).success).toBe(false);
  });
});

describe("cart currency", () => {
  it("requires the currency", () => {
    const cart = { id: "c1", items: [], couponCode: null, totals: { ...totals, subtotalCents: 0 } };
    const zero = {
      subtotalCents: 0,
      discountCents: 0,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 0,
    };
    expect(Cart.safeParse({ ...cart, totals: zero }).success).toBe(false);
    expect(Cart.parse({ ...cart, totals: zero, currency: "OMR" }).currency).toBe("OMR");
  });
});

describe("Phase 3b error codes", () => {
  it.each([
    ["PAYMENT_METHOD_UNAVAILABLE", 422],
    ["CURRENCY_LOCKED", 409],
    ["AMOUNT_MISMATCH", 422],
  ] as const)("%s maps to HTTP %i", (code, status) => {
    expect(ERROR_CODES).toContain(code);
    expect(ERROR_HTTP_STATUS[code]).toBe(status);
  });
});

describe("admin account", () => {
  it("parses a password reset request", () => {
    expect(AdminPasswordResetInput.parse({})).toEqual({});
    expect(AdminPasswordResetInput.parse({ resetTwoFactor: true }).resetTwoFactor).toBe(true);
    expect(AdminPasswordResetInput.safeParse({ password: "x" }).success).toBe(false);
    expect(PasswordResetSent.parse({ sent: true }).sent).toBe(true);
  });

  it("validates the staff reset-password body", () => {
    const token = "t".repeat(32);
    expect(AdminResetPasswordInput.safeParse({ token, password: "short" }).success).toBe(false);
    expect(
      AdminResetPasswordInput.safeParse({ token, password: "a long enough passphrase" }).success,
    ).toBe(true);
  });

  it("parses the admin profile", () => {
    const profile = AdminProfile.parse({
      id: "u1",
      email: "admin@example.om",
      firstName: "Aisha",
      lastName: "Al Balushi",
      role: "ADMIN",
      emailVerified: true,
      totpEnabledAt: NOW,
    });
    expect(profile.totpEnabledAt).toBe(NOW);
  });

  it("validates a password change", () => {
    const input = {
      currentPassword: "old password here",
      newPassword: "a brand new passphrase",
      totpCode: "123456",
    };
    expect(ChangePasswordInput.parse(input)).toEqual(input);
    expect(ChangePasswordInput.safeParse({ ...input, totpCode: "12345" }).success).toBe(false);
    expect(ChangePasswordInput.safeParse({ ...input, newPassword: "short" }).success).toBe(false);
    expect(
      ChangePasswordInput.safeParse({ ...input, newPassword: input.currentPassword }).success,
    ).toBe(false);
  });
});
