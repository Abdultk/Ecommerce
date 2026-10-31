import type { ReactNode } from "react";
import type { Permission } from "@hp/contracts";
import { Can } from "@/components/Can";

export function NoAccess({ label }: { label: string }) {
  return (
    <div role="alert" className="panel max-w-xl p-6">
      <h1 className="font-display text-xl text-ink-950">No access to {label}</h1>
      <p className="mt-2 text-sm text-muted">
        Your role can't open this section. Ask a super admin if you need it.
      </p>
    </div>
  );
}

/** Renders a whole section only for roles with `perm`; the API enforces the same rule. */
export function RequirePermission({
  perm,
  label,
  children,
}: {
  perm: Permission;
  label: string;
  children: ReactNode;
}) {
  return (
    <Can perm={perm} fallback={<NoAccess label={label} />}>
      {children}
    </Can>
  );
}

/** Shows a field's error under it; pair the id with aria-describedby on the input. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs font-medium text-danger-800">
      {message}
    </p>
  );
}
