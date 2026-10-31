import {
  AddressInput,
  OMAN_GOVERNORATES,
  ShippingAddress,
  type Address,
  type StoredAddress,
} from "@hp/contracts";
import { validateForm, type FieldErrors, type FormResult } from "./forms";

export const ADDRESS_FIELDS = [
  "fullName",
  "region",
  "city",
  "line1",
  "line2",
  "postalCode",
  "phone",
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type AddressValues = Record<AddressField, string>;
export type AddressErrors = FieldErrors<AddressField>;

export const GOVERNORATE_OPTIONS = OMAN_GOVERNORATES.map((g) => ({
  value: g.code,
  label: g.name,
}));
const GOVERNORATE_NAMES: ReadonlyMap<string, string> = new Map(
  OMAN_GOVERNORATES.map((g) => [g.code, g.name]),
);

/** "MA" → "Muscat"; anything else (an older non-Omani address) is shown as stored. */
export const governorateName = (code: string): string => GOVERNORATE_NAMES.get(code) ?? code;

export const EMPTY_ADDRESS: AddressValues = {
  fullName: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  phone: "",
};

/**
 * Form values for a saved address (missing fields become ""). A region that is not an
 * Omani governorate is dropped, so the customer picks one instead of resending it.
 */
export function addressToValues(address: StoredAddress | undefined): AddressValues {
  if (!address) return EMPTY_ADDRESS;
  return {
    fullName: address.fullName,
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    region: GOVERNORATE_NAMES.has(address.region) ? address.region : "",
    postalCode: address.postalCode ?? "",
    phone: address.phone ?? "",
  };
}

/** Validates with the contract's ShippingAddress (Oman only); blank optional fields are left out. */
export function parseAddress(values: AddressValues): FormResult<ShippingAddress, AddressField> {
  const input = {
    ...values,
    line2: values.line2.trim() || undefined,
    postalCode: values.postalCode.trim() || undefined,
    country: "OM",
  };
  const result = validateForm(ShippingAddress, input as unknown as Record<AddressField, string>);
  return result as FormResult<ShippingAddress, AddressField>;
}

/**
 * A saved address re-checked as input (e.g. to make it the default). Addresses saved
 * before the switch to Oman fail and return null: they have to be edited first.
 */
export function toAddressInput(address: Address, isDefault: boolean): AddressInput | null {
  const { id: _id, ...rest } = address;
  const parsed = AddressInput.safeParse({
    ...rest,
    line2: rest.line2 ?? undefined,
    postalCode: rest.postalCode ?? undefined,
    phone: rest.phone ?? "",
    isDefault,
  });
  return parsed.success ? parsed.data : null;
}
