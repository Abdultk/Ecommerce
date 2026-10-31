import { describe, expect, it } from "vitest";
import {
  AccountSession,
  CustomerChangePasswordInput,
  CustomerPreferences,
  CustomerPreferencesUpdate,
  DeleteAccountInput,
} from "../src";

describe("CustomerPreferencesUpdate", () => {
  it("normalises an Omani phone number", () => {
    expect(CustomerPreferencesUpdate.parse({ phone: "+968 9123 4567" })).toEqual({
      phone: "+96891234567",
    });
  });

  it("clears the phone with an empty string or null", () => {
    expect(CustomerPreferencesUpdate.parse({ phone: "" })).toEqual({ phone: null });
    expect(CustomerPreferencesUpdate.parse({ phone: null })).toEqual({ phone: null });
  });

  it("rejects a phone that isn't Omani", () => {
    expect(CustomerPreferencesUpdate.safeParse({ phone: "+14155550123" }).success).toBe(false);
  });

  it("accepts each checkout default and lets the shopper unset it", () => {
    expect(
      CustomerPreferencesUpdate.parse({
        preferredPayment: "bank_transfer",
        preferredShipping: "express",
      }),
    ).toEqual({ preferredPayment: "bank_transfer", preferredShipping: "express" });
    expect(CustomerPreferencesUpdate.parse({ preferredPayment: null })).toEqual({
      preferredPayment: null,
    });
  });

  it("refuses unknown fields and empty updates", () => {
    expect(
      CustomerPreferencesUpdate.safeParse({ role: "ADMIN", marketingEmails: true }).success,
    ).toBe(false);
    expect(CustomerPreferencesUpdate.safeParse({}).success).toBe(false);
  });

  it("keeps the consent switches as plain booleans", () => {
    expect(
      CustomerPreferencesUpdate.parse({ marketingEmails: true, shippingUpdateEmails: false }),
    ).toEqual({ marketingEmails: true, shippingUpdateEmails: false });
    expect(CustomerPreferencesUpdate.safeParse({ marketingEmails: "yes" }).success).toBe(false);
  });
});

describe("CustomerPreferences", () => {
  it("describes a customer who has never saved anything", () => {
    expect(
      CustomerPreferences.parse({
        phone: null,
        marketingEmails: false,
        shippingUpdateEmails: true,
        preferredPayment: null,
        preferredShipping: null,
        updatedAt: null,
      }),
    ).toMatchObject({ marketingEmails: false, shippingUpdateEmails: true });
  });
});

describe("CustomerChangePasswordInput", () => {
  const input = {
    currentPassword: "old password value",
    newPassword: "a much longer new passphrase",
  };

  it("accepts a different, long enough password", () => {
    expect(CustomerChangePasswordInput.safeParse(input).success).toBe(true);
  });

  it("refuses reusing the current password", () => {
    const result = CustomerChangePasswordInput.safeParse({
      ...input,
      newPassword: input.currentPassword,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Choose a password different from your current one.",
      );
    }
  });

  it("refuses a short new password with the rule in plain words", () => {
    const result = CustomerChangePasswordInput.safeParse({ ...input, newPassword: "short" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Use at least 12 characters.");
    }
  });
});

describe("DeleteAccountInput", () => {
  it("needs the password and the exact word", () => {
    expect(DeleteAccountInput.safeParse({ password: "pw", confirm: "DELETE" }).success).toBe(true);
    const bad = DeleteAccountInput.safeParse({ password: "pw", confirm: "delete" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe("Type DELETE to confirm.");
    expect(DeleteAccountInput.safeParse({ password: "", confirm: "DELETE" }).success).toBe(false);
  });
});

describe("AccountSession", () => {
  it("is one device with its sign-in and expiry times", () => {
    expect(
      AccountSession.parse({
        id: "ses_1",
        device: "Chrome on Windows",
        signedInAt: "2026-10-15T09:00:00.000Z",
        expiresAt: "2026-10-22T09:00:00.000Z",
        current: true,
      }).current,
    ).toBe(true);
  });
});
