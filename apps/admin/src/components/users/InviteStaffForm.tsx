"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { AdminInviteInput, AdminUserListItem, STAFF_ROLES } from "@hp/contracts";
import { Can } from "@/components/Can";
import { FieldError } from "@/components/ui/NoAccess";
import { roleLabel } from "@/lib/format";
import { USERS_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";

type StaffRole = (typeof STAFF_ROLES)[number];
type Fields = { email: string; firstName: string; lastName: string; role: StaffRole };
const EMPTY: Fields = { email: "", firstName: "", lastName: "", role: "STAFF" };

/** Invites staff by email; they set a password and enroll 2FA from the link. */
export function InviteStaffForm() {
  return (
    <Can perm="user:write">
      <InviteForm />
    </Can>
  );
}

function InviteForm() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const ids = useId();
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFormError(null);
    const parsed = AdminInviteInput.safeParse(fields);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [String(i.path[0]), i.message]).reverse(),
        ),
      );
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api.post("/admin/users/invite", parsed.data, AdminUserListItem);
      await queryClient.invalidateQueries({ queryKey: USERS_KEY });
      setFields(EMPTY);
      setNotice(
        `Invite sent to ${parsed.data.email}. The link works once and expires in 72 hours.`,
      );
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const input = (key: Exclude<keyof Fields, "role">, label: string, type = "text") => (
    <div>
      <label htmlFor={`${ids}-${key}`} className="field-label">
        {label}
      </label>
      <input
        id={`${ids}-${key}`}
        type={type}
        value={fields[key]}
        autoComplete="off"
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${ids}-${key}-error` : undefined}
        onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
        className="field field-compact"
      />
      <FieldError id={`${ids}-${key}-error`} message={errors[key]} />
    </div>
  );

  return (
    <form
      aria-labelledby={`${ids}-title`}
      noValidate
      onSubmit={handleSubmit}
      className="panel space-y-3 p-4"
    >
      <h2 id={`${ids}-title`} className="font-display text-lg text-ink-950">
        Invite staff
      </h2>
      <p className="text-sm text-muted">
        They get an email link to set a password and add two-factor sign-in.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {input("email", "Email", "email")}
        {input("firstName", "First name")}
        {input("lastName", "Last name")}
        <div>
          <label htmlFor={`${ids}-role`} className="field-label">
            Role
          </label>
          <select
            id={`${ids}-role`}
            value={fields.role}
            onChange={(e) => setFields((f) => ({ ...f, role: e.target.value as StaffRole }))}
            className="field field-compact"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {formError && (
        <p role="alert" className="error-text">
          {formError}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Send invite
      </button>
    </form>
  );
}
