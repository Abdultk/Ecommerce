"use client";

import { useId, useState, type FormEvent } from "react";
import { ChangePasswordInput } from "@hp/contracts";
import { FormStatus, TextField } from "@/components/settings/shared";
import { useEndpoints } from "@/lib/store-settings";
import { errorMessage } from "@/lib/session";

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirm: string;
  totpCode: string;
};
type PasswordErrors = Partial<Record<keyof PasswordForm | "form", string>>;

const EMPTY: PasswordForm = { currentPassword: "", newPassword: "", confirm: "", totpCode: "" };
/** Schema fields that map onto an input; any other issue is shown at form level. */
const INPUT_FIELDS = ["currentPassword", "newPassword", "totpCode"] as const;

/** Changes the signed-in admin's password. The API also signs out every other session. */
export function ChangePasswordForm() {
  const endpoints = useEndpoints();
  const ids = useId();
  const [form, setForm] = useState<PasswordForm>(EMPTY);
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const field = (key: keyof PasswordForm) => (value: string) => setForm({ ...form, [key]: value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    setFailure(null);
    const nextErrors: PasswordErrors = {};
    if (form.newPassword !== form.confirm) nextErrors.confirm = "The new passwords don't match.";
    const parsed = ChangePasswordInput.safeParse({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
      totpCode: form.totpCode.trim(),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = INPUT_FIELDS.find((name) => name === issue.path[0]) ?? "form";
        nextErrors[key] = issue.message;
      }
    }
    setErrors(nextErrors);
    if (!parsed.success || nextErrors.confirm) return;
    try {
      await endpoints.adminMe.changePassword(parsed.data);
      setForm(EMPTY);
      setNotice("Password changed. Your other devices were signed out.");
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <TextField
        id={`${ids}-current`}
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={form.currentPassword}
        error={errors.currentPassword}
        onChange={field("currentPassword")}
      />
      <TextField
        id={`${ids}-totp`}
        label="2FA code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={form.totpCode}
        error={errors.totpCode}
        onChange={field("totpCode")}
      />
      <TextField
        id={`${ids}-new`}
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        value={form.newPassword}
        error={errors.newPassword}
        onChange={field("newPassword")}
      />
      <TextField
        id={`${ids}-confirm`}
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={form.confirm}
        error={errors.confirm}
        onChange={field("confirm")}
      />
      <div className="sm:col-span-2">
        <FormStatus notice={notice} error={errors.form ?? failure} />
      </div>
    </form>
  );
}
