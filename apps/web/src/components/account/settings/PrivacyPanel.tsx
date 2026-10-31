"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DeleteAccountInput } from "@hp/contracts";
import { TextField } from "@/components/auth/TextField";
import { useDeleteAccount, useExportData } from "@/lib/account-settings";
import { readFields, validateForm, type FieldErrors } from "@/lib/forms";
import { errorMessage } from "@/lib/orders";
import { useFieldFocus } from "@/lib/use-field-focus";

const FIELDS = ["password", "confirm"] as const;
type Field = (typeof FIELDS)[number];

/** Hands the document to the browser as a file; nothing leaves the page. */
function downloadJson(data: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "hearth-and-pan-my-data.json";
  link.click();
  URL.revokeObjectURL(url);
}

function ExportData() {
  const t = useTranslations("Account.privacy");
  const exporter = useExportData();
  return (
    <section aria-labelledby="priv-export" className="max-w-xl space-y-3">
      <h2 id="priv-export" className="text-xl">
        {t("yourData")}
      </h2>
      <p className="text-smoke">{t("exportBody")}</p>
      {exporter.isError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {errorMessage(exporter.error)}
        </p>
      ) : null}
      <button
        type="button"
        className="btn"
        disabled={exporter.isPending}
        onClick={() => exporter.mutate(undefined, { onSuccess: downloadJson })}
      >
        {exporter.isPending ? t("preparing") : t("download")}
      </button>
    </section>
  );
}

function DeleteAccount() {
  const t = useTranslations("Account.privacy");
  const router = useRouter();
  const remove = useDeleteAccount();
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const { fieldRef, focusFirst } = useFieldFocus(FIELDS);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateForm(DeleteAccountInput, readFields(event.currentTarget, FIELDS));
    if (!result.success) {
      setErrors(result.errors);
      focusFirst(result.errors);
      return;
    }
    setErrors({});
    remove.mutate(result.data, { onSuccess: () => router.replace("/") });
  }

  return (
    <section aria-labelledby="priv-delete" className="max-w-md space-y-4">
      <h2 id="priv-delete" className="text-xl">
        {t("deleteHeading")}
      </h2>
      <p className="text-smoke">{t("deleteBody")}</p>
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <TextField
          ref={fieldRef("password")}
          name="password"
          type="password"
          label={t("yourPassword")}
          autoComplete="current-password"
          error={errors.password}
          required
        />
        <TextField
          ref={fieldRef("confirm")}
          name="confirm"
          label={t("typeDelete")}
          autoComplete="off"
          error={errors.confirm}
          required
        />
        {remove.isError ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {errorMessage(remove.error)}
          </p>
        ) : null}
        <button type="submit" className="btn btn-iron" disabled={remove.isPending}>
          {remove.isPending ? t("deleting") : t("delete")}
        </button>
      </form>
    </section>
  );
}

export function PrivacyPanel() {
  return (
    <div className="space-y-12">
      <ExportData />
      <DeleteAccount />
    </div>
  );
}
