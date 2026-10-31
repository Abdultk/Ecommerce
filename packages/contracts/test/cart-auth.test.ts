import { describe, expect, it } from "vitest";
import { Admin2faInput, LoginInput, RegisterInput, ResetPasswordInput } from "../src/auth";
import { AddCartItemInput, ApplyCouponInput, Cart, UpdateCartItemInput } from "../src/cart";
import { ProfileUpdate } from "../src/user";

describe("cart inputs", () => {
  it.each([0, 100, 1.5, -1])("rejects quantity %s", (quantity) => {
    expect(AddCartItemInput.safeParse({ variantId: "v1", quantity }).success).toBe(false);
    expect(UpdateCartItemInput.safeParse({ quantity }).success).toBe(false);
  });

  it("accepts quantities from 1 to 99", () => {
    expect(AddCartItemInput.safeParse({ variantId: "v1", quantity: 99 }).success).toBe(true);
  });

  it("normalizes coupon codes", () => {
    expect(ApplyCouponInput.parse({ code: " save10 " }).code).toBe("SAVE10");
  });

  it("rejects coupon codes with symbols", () => {
    expect(ApplyCouponInput.safeParse({ code: "SAVE<10>" }).success).toBe(false);
  });

  it("requires cart totals to add up", () => {
    const cart = {
      id: "cart1",
      couponCode: null,
      currency: "OMR",
      items: [],
      // Empty cart, so subtotal is 0; shipping and tax still have to add up.
      totals: {
        subtotalCents: 0,
        discountCents: 0,
        shippingCents: 900,
        taxCents: 100,
        totalCents: 999,
      },
    };
    expect(Cart.safeParse(cart).success).toBe(false);
    expect(Cart.safeParse({ ...cart, totals: { ...cart.totals, totalCents: 1000 } }).success).toBe(
      true,
    );
  });

  it("rejects a discount larger than the subtotal", () => {
    const totals = {
      subtotalCents: 500,
      discountCents: 600,
      shippingCents: 100,
      taxCents: 0,
      totalCents: 0,
    };
    expect(Cart.safeParse({ id: "cart1", couponCode: "BIG", items: [], totals }).success).toBe(
      false,
    );
  });
});

describe("auth inputs", () => {
  const registration = {
    email: " Ada@Example.com ",
    password: "correct horse battery",
    firstName: "Ada",
    lastName: "Cook",
  };

  it("normalizes the email on register and login", () => {
    expect(RegisterInput.parse(registration).email).toBe("ada@example.com");
    expect(LoginInput.parse({ email: "ADA@example.com", password: "x" }).email).toBe(
      "ada@example.com",
    );
  });

  it("requires passwords of 12 to 128 characters", () => {
    expect(RegisterInput.safeParse({ ...registration, password: "short" }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...registration, password: "x".repeat(129) }).success).toBe(
      false,
    );
  });

  it("applies the same password rule to resets", () => {
    expect(ResetPasswordInput.safeParse({ token: "t".repeat(32), password: "short" }).success).toBe(
      false,
    );
    expect(
      ResetPasswordInput.safeParse({ token: "t".repeat(32), password: "long enough pass" }).success,
    ).toBe(true);
  });

  it.each(["12345", "1234567", "12a456"])("rejects TOTP code %s", (code) => {
    expect(Admin2faInput.safeParse({ challengeToken: "c", code }).success).toBe(false);
  });

  it("accepts a six-digit TOTP code", () => {
    expect(Admin2faInput.safeParse({ challengeToken: "c", code: "004211" }).success).toBe(true);
  });
});

describe("ProfileUpdate", () => {
  it("rejects an empty update", () => {
    expect(ProfileUpdate.safeParse({}).success).toBe(false);
  });

  it("trims names", () => {
    expect(ProfileUpdate.parse({ firstName: "  Ada " }).firstName).toBe("Ada");
  });
});
