import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { RequirePermission } from "@/components/ui/NoAccess";
import { InviteStaffForm } from "@/components/users/InviteStaffForm";
import { UsersTable } from "@/components/users/UsersTable";

export const metadata: Metadata = { title: "Staff" };

export default function StaffPage() {
  return (
    <RequirePermission perm="user:write" label="Staff">
      <PageHeader
        eyebrow="People"
        title="Staff and access"
        description="Invite staff, change roles and disable accounts. Every change ends the person's current sessions and is written to the audit log."
      />
      <div className="space-y-6">
        <InviteStaffForm />
        <UsersTable defaultRole="ALL" />
      </div>
    </RequirePermission>
  );
}
