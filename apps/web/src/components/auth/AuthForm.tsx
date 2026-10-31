"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { AuthSession } from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import { browserApi } from "@/lib/api";
import { authStore } from "@/lib/auth-store";
import { CART_QUERY_KEY, cartQueryKey, mergeGuestCart } from "@/lib/cart";
import { readFields, safeRedirect, validateForm, type FieldErrors } from "@/lib/forms";
import { TextField } from "./TextField";

export type AuthFieldSpec<K extends string> = {
  name: K;
  label: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  hint?: string;
};

type Props<K extends string> = {
  schema: z.ZodTypeAny;
  fields: readonly AuthFieldSpec<K>[];
  endpoint: "/auth/login" | "/auth/register";
  submitLabel: string;
  pendingLabel: string;
  redirectTo?: string;
  footer?: ReactNode;
  /** Register only: the API answers 202 with no session, so the caller shows the next step. */
  onRegistered?: (values: Record<K, string>) => void;
};

/** Client-validated auth form: field errors via aria-describedby, server errors in an alert. */
export function AuthForm<K extends string>({
  schema,
  fields,
  endpoint,
  submitLabel,
  pendingLabel,
  redirectTo,
  footer,
  onRegistered,
}: Props<K>) {
  const t = useTranslations("Auth");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors<K>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputs = useRef<Partial<Record<K, HTMLInputElement | null>>>({});

  /** Folds the guest cart into the account's. A failure must not block sign-in. */
  async function mergeCartAfterSignIn() {
    try {
      const merged = await mergeGuestCart();
      // Stored under the account's key (the session is set by now), not the guest's.
      queryClient.setQueryData(cartQueryKey(authStore.getState().user?.id ?? null), merged);
    } catch (err) {
      console.warn("[cart] merge after sign-in failed", err instanceof Error ? err.name : "error");
      await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const values = readFields(
      event.currentTarget,
      fields.map((f) => f.name),
    );
    const result = validateForm(schema, values);
    if (!result.success) {
      setErrors(result.errors);
      const firstInvalid = fields.find((f) => result.errors[f.name]);
      if (firstInvalid) inputs.current[firstInvalid.name]?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      if (endpoint === "/auth/register") {
        await browserApi.post(endpoint, result.data);
        onRegistered?.(values as Record<K, string>);
        return;
      }
      const { data } = await browserApi.post(endpoint, result.data, AuthSession);
      authStore.setSession(data);
      await mergeCartAfterSignIn();
      router.push(safeRedirect(redirectTo));
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : t("generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    // method="post": a submit before hydration must never put credentials in the URL.
    <form method="post" onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-tile)] bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
        >
          {formError}
        </p>
      ) : null}
      {fields.map((field) => (
        <TextField
          key={field.name}
          ref={(el) => {
            inputs.current[field.name] = el;
          }}
          name={field.name}
          label={field.label}
          type={field.type}
          autoComplete={field.autoComplete}
          hint={field.hint}
          error={errors[field.name]}
          required
        />
      ))}
      <button type="submit" className="btn btn-primary w-full text-base" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
      {footer}
    </form>
  );
}
