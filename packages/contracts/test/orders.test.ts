import { describe, expect, it } from "vitest";
import {
  CheckoutInput,
  ORDER_NUMBER_PATTERN,
  ORDER_TRANSITIONS,
  OrderStatus,
  ShippingAddress,
  canTransition,
  formatOrderNumber,
  isTerminalStatus,
} from "../src/orders";

const address = {
  fullName: "Salim Al Harthy",
  line1: "Al Khuwair, Way 3021",
  city: "Bawshar",
  region: "ma",
  postalCode: "133",
  country: "OM",
  phone: "+968 9123 4567",
};

describe("ORDER_TRANSITIONS", () => {
  it("defines transitions for every status", () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...OrderStatus.options].sort());
  });

  it("only targets valid statuses and never the same status", () => {
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(OrderStatus.options).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it.each([
    ["PENDING_PAYMENT", "CANCELLED", true],
    ["PAID", "PROCESSING", true],
    ["PROCESSING", "SHIPPED", true],
    ["SHIPPED", "DELIVERED", true],
    ["DELIVERED", "REFUNDED", true],
    ["SHIPPED", "PROCESSING", false],
    ["PENDING_PAYMENT", "PAID", false], // only the Stripe webhook may mark an order paid
    ["DELIVERED", "PROCESSING", false],
    ["SHIPPED", "CANCELLED", false],
    ["CANCELLED", "PAID", false],
  ] as const)("canTransition(%s → %s) is %s", (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });

  it("treats CANCELLED and REFUNDED as terminal", () => {
    const terminal = OrderStatus.options.filter(isTerminalStatus);
    expect(terminal.sort()).toEqual(["CANCELLED", "REFUNDED"]);
  });
});

describe("formatOrderNumber", () => {
  it("pads the sequence to six digits", () => {
    expect(formatOrderNumber(2026, 123)).toBe("HP-2026-000123");
  });

  it("produces numbers that match ORDER_NUMBER_PATTERN", () => {
    expect(ORDER_NUMBER_PATTERN.test(formatOrderNumber(2027, 999_999))).toBe(true);
  });

  it.each([0, -1, 1_000_000, 1.5])("rejects sequence %s", (seq) => {
    expect(() => formatOrderNumber(2026, seq)).toThrow(RangeError);
  });

  it("rejects an implausible year", () => {
    expect(() => formatOrderNumber(99, 1)).toThrow(RangeError);
  });
});

describe("ShippingAddress", () => {
  it("normalizes the governorate code to upper case", () => {
    expect(ShippingAddress.parse(address).region).toBe("MA");
  });

  it.each(["13", "ABC", "1334", "94105"])("rejects postal code %s", (postalCode) => {
    expect(ShippingAddress.safeParse({ ...address, postalCode }).success).toBe(false);
  });

  it("rejects non-Omani addresses", () => {
    expect(ShippingAddress.safeParse({ ...address, country: "AE" }).success).toBe(false);
  });
});

describe("CheckoutInput", () => {
  it("lower-cases and trims the email", () => {
    const parsed = CheckoutInput.parse({
      email: "  Ada@Example.COM ",
      shippingAddress: address,
      shippingMethod: "standard",
      paymentMethod: "card",
    });
    expect(parsed.email).toBe("ada@example.com");
  });

  it("rejects unknown shipping methods", () => {
    const result = CheckoutInput.safeParse({
      email: "ada@example.com",
      shippingAddress: address,
      shippingMethod: "teleport",
      paymentMethod: "card",
    });
    expect(result.success).toBe(false);
  });
});
