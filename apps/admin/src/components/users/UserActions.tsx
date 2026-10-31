"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { AdminUserListItem, ROLES, isAdminRole, type Role } from "@hp/contracts";
import { Can } from "@/components/Can";
import { TypedConfirmDialog } from "@/components/ui/TypedConfirmDialog";
import { roleLabel } from "@/lib/format";
import { USERS_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";

type Dialog = "role" | "disable" | "invite" | null;

/**
 * Account controls for one user (user:write = SUPER_ADMIN). Destructive changes need
 * the email typed. The API refuses changes to your own account; its message is shown.
 */
export function UserActions({
  person,
  onNotice,
}: {
  person: AdminUserListItem;
  onNotice: (text: string) => void;
}) {
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const ids = useId();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [role, setRole] = useState<Role>(person.role);
  const [enableError, setEnableError] = useState<string | null>(null);
  const isSelf = user?.id === person.id;
  const fullName = `${person.firstName} ${person.lastName}${isSelf ? " (you)" : ""}`;

  const refresh = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });

  const patch = async (body: { role?: Role; disabled?: boolean }) => {
    await api.patch(`/admin/users/${person.id}`, body, AdminUserListItem);
    await refresh();
    setDialog(null);
  };

  const small = "btn btn-quiet min-h-8 px-2 text-xs";
  return (
    <Can perm="user:write">
      <div className="flex flex-wrap justify-end gap-1">
        <button
          type="button"
          className={small}
          onClick={() => {
            setRole(person.role);
            setDialog("role");
          }}
        >
          Change role<span className="sr-only"> {person.email}</span>
        </button>
        {person.disabled ? (
          <button
            type="button"
            className={small}
            onClick={async () => {
              setEnableError(null);
              try {
                await patch({ disabled: false });
                onNotice(`${person.email} can sign in again.`);
              } catch (err) {
                setEnableError(errorMessage(err));
              }
            }}
          >
            Enable<span className="sr-only"> {person.email}</span>
          </button>
        ) : (
          <button type="button" className={small} onClick={() => setDialog("disable")}>
            Disable<span className="sr-only"> {person.email}</span>
          </button>
        )}
        {isAdminRole(person.role) && !person.disabled && (
          <button type="button" className={small} onClick={() => setDialog("invite")}>
            Resend invite<span className="sr-only"> {person.email}</span>
          </button>
        )}
      </div>
      {enableError && (
        <p role="alert" className="mt-1 text-xs text-danger-800">
          {enableError}
        </p>
      )}

      {dialog === "role" && (
        <TypedConfirmDialog
          title={`Change role for ${fullName}`}
          description="Their current sessions end straight away so the new permissions apply. Moving staff to Customer also removes their two-factor setup."
          phrase={person.email}
          confirmLabel="Change role"
          onClose={() => setDialog(null)}
          validate={() => (role === person.role ? "Choose a different role." : null)}
          onConfirm={async () => {
            await patch({ role });
            onNotice(`${person.email} is now ${roleLabel(role)}.`);
          }}
        >
          <div>
            <label htmlFor={`${ids}-role`} className="field-label">
              New role
            </label>
            <select
              id={`${ids}-role`}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="field"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
        </TypedConfirmDialog>
      )}
      {dialog === "disable" && (
        <TypedConfirmDialog
          title={`Disable ${fullName}?`}
          description="They are signed out everywhere and can't sign in until an admin enables the account again."
          phrase={person.email}
          confirmLabel="Disable account"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await patch({ disabled: true });
            onNotice(`${person.email} was disabled.`);
          }}
        />
      )}
      {dialog === "invite" && (
        <TypedConfirmDialog
          title={`Reset access for ${fullName}?`}
          description="Their password and authenticator are reset and they're emailed a new invite link (for example after a lost phone). The link expires in 72 hours."
          phrase={person.email}
          confirmLabel="Send new invite"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.post(`/admin/users/${person.id}/invite`, undefined, AdminUserListItem);
            await refresh();
            setDialog(null);
            onNotice(`New invite sent to ${person.email}.`);
          }}
        />
      )}
    </Can>
  );
}
