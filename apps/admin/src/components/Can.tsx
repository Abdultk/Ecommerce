"use client";

import type { ReactNode } from "react";
import { can, type Permission } from "@hp/contracts";
import { useSession } from "@/lib/session";

type CanProps = {
  perm: Permission;
  children: ReactNode;
  fallback?: ReactNode;
};

/** Hides UI the signed-in role may not use. UX only: the API enforces the same can() check. */
export function Can({ perm, children, fallback = null }: CanProps) {
  const { user } = useSession();
  return <>{user && can(user.role, perm) ? children : fallback}</>;
}
