"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { can } from "@hp/contracts";
import { FieldError } from "@/components/ui/NoAccess";
import { SETTINGS_KEY, STORE_CONFIG_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";

/** Only SUPER_ADMIN may write settings; everyone with settings:read sees the forms read-only. */
export function useCanWriteSettings(): boolean {
  const { user } = useSession();
  return user !== null && can(user.role, "settings:write");
}

/**
 * Runs one save: refreshes the settings and the public store config afterwards, and keeps
 * the notice or the API's message for the form to show.
 */
export function useSave() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, done = "Saved.") => {
    setNotice(null);
    setError(null);
    try {
      await action();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
        queryClient.invalidateQueries({ queryKey: STORE_CONFIG_KEY }),
      ]);
      setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return { notice, error, run };
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="panel p-6">
      <h2 className="text-lg font-semibold text-ink-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: "text" | "password";
  inputMode?: "decimal" | "numeric" | "text";
  autoComplete?: string;
};

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  inputMode,
  autoComplete,
}: TextFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="field"
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function FormStatus({ notice, error }: { notice: string | null; error: string | null }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button type="submit" className="btn btn-primary">
        Save changes
      </button>
      {notice && (
        <p role="status" className="text-sm text-ink-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
