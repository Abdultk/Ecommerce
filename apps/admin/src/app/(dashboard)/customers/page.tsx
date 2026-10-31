import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { RequirePermission } from "@/components/ui/NoAccess";
import { UsersTable } from "@/components/users/UsersTable";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <RequirePermission perm="user:read" label="Customers">
      <PageHeader
        eyebrow="People"
        title="Customers"
        description="Customer accounts with their paid order count. Change the role filter to see staff too."
      />
      <UsersTable defaultRole="CUSTOMER" />
    </RequirePermission>
  );
}
