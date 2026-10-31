import { useTranslations } from "next-intl";
import { TextField } from "@/components/auth/TextField";
import { SelectField } from "@/components/forms/SelectField";
import {
  GOVERNORATE_OPTIONS,
  type AddressErrors,
  type AddressField,
  type AddressValues,
} from "@/lib/address-form";
import { useGovernorateName } from "@/lib/use-governorate-name";

type Props = {
  defaults: AddressValues;
  errors: AddressErrors;
  /** Lets the parent focus the first invalid field. */
  fieldRef: (name: AddressField) => (el: HTMLElement | null) => void;
};

/** Omani delivery address fields shared by checkout and the address book. */
export function AddressFields({ defaults, errors, fieldRef }: Props) {
  const t = useTranslations("Checkout.address");
  const governorate = useGovernorateName();
  const governorates = GOVERNORATE_OPTIONS.map((o) => ({ ...o, label: governorate(o.value) }));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextField
          ref={fieldRef("fullName")}
          name="fullName"
          label={t("fullName")}
          autoComplete="name"
          defaultValue={defaults.fullName}
          error={errors.fullName}
          required
        />
      </div>
      <SelectField
        ref={fieldRef("region")}
        name="region"
        label={t("governorate")}
        autoComplete="address-level1"
        placeholder={t("chooseGovernorate")}
        options={governorates}
        defaultValue={defaults.region}
        error={errors.region}
        required
      />
      <TextField
        ref={fieldRef("city")}
        name="city"
        label={t("wilayat")}
        autoComplete="address-level2"
        defaultValue={defaults.city}
        error={errors.city}
        hint={t("wilayatHint")}
        required
      />
      <div className="sm:col-span-2">
        <TextField
          ref={fieldRef("line1")}
          name="line1"
          label={t("line1")}
          autoComplete="address-line1"
          defaultValue={defaults.line1}
          error={errors.line1}
          hint={t("line1Hint")}
          required
        />
      </div>
      <div className="sm:col-span-2">
        <TextField
          ref={fieldRef("line2")}
          name="line2"
          label={t("line2")}
          autoComplete="address-line2"
          defaultValue={defaults.line2}
          error={errors.line2}
        />
      </div>
      <TextField
        ref={fieldRef("postalCode")}
        name="postalCode"
        label={t("postalCode")}
        autoComplete="postal-code"
        inputMode="numeric"
        maxLength={3}
        defaultValue={defaults.postalCode}
        error={errors.postalCode}
        hint={t("postalCodeHint")}
      />
      <TextField
        ref={fieldRef("phone")}
        name="phone"
        label={t("phone")}
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        defaultValue={defaults.phone}
        error={errors.phone}
        hint={t("phoneHint")}
        required
      />
    </div>
  );
}
