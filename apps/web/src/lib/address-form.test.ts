import { describe, expect, it } from "vitest";
import { OMAN_GOVERNORATES, type Address } from "@hp/contracts";
import {
  EMPTY_ADDRESS,
  GOVERNORATE_OPTIONS,
  addressToValues,
  governorateName,
  parseAddress,
  toAddressInput,
} from "./address-form";

const valid = {
  ...EMPTY_ADDRESS,
  fullName: "Salim Al Harthy",
  line1: "Al Khuwair, Way 3021",
  line2: "Villa 12",
  city: "Bawshar",
  region: "MA",
  postalCode: "133",
  phone: "9123 4567",
};

describe("Oman address form", () => {
  it("offers every governorate by name, keyed by its ISO code", () => {
    expect(GOVERNORATE_OPTIONS).toHaveLength(OMAN_GOVERNORATES.length);
    expect(GOVERNORATE_OPTIONS[0]).toEqual({ value: "MA", label: "Muscat" });
    expect(governorateName("ZU")).toBe("Dhofar");
    expect(governorateName("CA")).toBe("CA");
  });

  it("parses a complete address, normalising the phone to +968", () => {
    const result = parseAddress(valid);
    expect(result).toEqual({
      success: true,
      data: { ...valid, country: "OM", phone: "+96891234567" },
    });
  });

  it("leaves blank optional fields out", () => {
    const result = parseAddress({ ...valid, line2: " ", postalCode: "" });
    expect(result.success && result.data.line2).toBeUndefined();
    expect(result.success && result.data.postalCode).toBeUndefined();
  });

  it("reports the contract's message per field", () => {
    const result = parseAddress({ ...valid, region: "", postalCode: "1234", phone: "12" });
    expect(result).toEqual({
      success: false,
      errors: {
        region: "Choose a governorate.",
        postalCode: "Postal codes in Oman have 3 digits.",
        phone: "Enter an Omani phone number, e.g. 9123 4567.",
      },
    });
    const missing = parseAddress({ ...valid, phone: "" });
    expect(missing.success ? null : missing.errors.phone).toMatch(/omani phone/i);
  });

  it("prefills from a stored address with nullable fields", () => {
    const stored: Address = {
      id: "a1",
      isDefault: true,
      fullName: "Ada",
      line1: "1 Market St",
      line2: null,
      city: "San Francisco",
      region: "CA",
      postalCode: null,
      country: "US",
      phone: null,
    };
    expect(addressToValues(stored)).toEqual({
      fullName: "Ada",
      line1: "1 Market St",
      line2: "",
      city: "San Francisco",
      region: "",
      postalCode: "",
      phone: "",
    });
    expect(addressToValues(undefined)).toEqual(EMPTY_ADDRESS);
  });

  it("re-validates a saved address before resending it, refusing old US ones", () => {
    const oman: Address = {
      id: "a2",
      isDefault: false,
      ...valid,
      country: "OM",
      phone: "+96891234567",
    };
    expect(toAddressInput(oman, true)).toMatchObject({ region: "MA", isDefault: true });
    expect(toAddressInput({ ...oman, country: "US", region: "CA" }, true)).toBeNull();
  });
});
