"use client";

import { useId, useState } from "react";
import { isAdminRole, type AdminUserListItem } from "@hp/contracts";
import { Can } from "@/components/Can";
import { TypedConfirmDialog } from "@/components/ui/TypedConfirmDialog";
import { useEndpoints } from "@/lib/store-settings";
import { useSession } from "@/lib/session";

/**
 * Emails a password-reset link to one account (user:reset-password: ADMIN and SUPER_ADMIN).
 * Staff accounts are reset by SUPER_ADMIN only, and nobody resets their own account here.
 * The admin never sets the password; the person chooses it from the link.
 */
export function SendPasswordResetButton({
  person,
  onNotice,
}: {
  person: AdminUserListItem;
  onNotice: (text: string) => void;
}) {
  const { user } = useSession();
  const endpoints = useEndpoints();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [resetTwoFactor, setResetTwoFactor] = useState(false);

  const isSelf = user?.id === person.id;
  const isStaff = isAdminRole(person.role);
  if (!user || isSelf || (isStaff && user.role !== "SUPER_ADMIN")) return null;

  const close = () => {
    setOpen(false);
    setResetTwoFactor(false);
  };

  return (
    <Can perm="user:reset-password">
      <button
        type="button"
        className="btn btn-quiet min-h-8 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        Send password reset<span className="sr-only"> {person.email}</span>
      </button>
      {open && (
        <TypedConfirmDialog
          title={`Send a password reset to ${person.email}?`}
          description="They're emailed a link to choose a new password. Use this when someone is locked out. You never see or set their password."
          phrase={person.email}
          confirmLabel="Send reset link"
          onClose={close}
          onConfirm={async () => {
            await endpoints.adminUsers.sendPasswordReset(
              person.id,
              resetTwoFactor ? { resetTwoFactor: true } : {},
            );
            close();
            onNotice(`Reset link sent to ${person.email}.`);
          }}
        >
          {isStaff && (
            <label htmlFor={`${ids}-2fa`} className="check-label">
              <input
                id={`${ids}-2fa`}
                type="checkbox"
                className="check"
                checked={resetTwoFactor}
                onChange={(e) => setResetTwoFactor(e.target.checked)}
              />
              Also reset their 2FA and send a new invite
            </label>
          )}
        </TypedConfirmDialog>
      )}
    </Can>
  );
}
