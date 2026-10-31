import type { Metadata } from "next";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { PageHeader } from "@/components/PageHeader";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <RequirePermission perm="order:read" label="Orders">
      <PageHeader
        eyebrow="Sales"
        title="Orders"
        description="Every order, newest first. Status, date range and search stay in the address bar."
      />
      <OrdersTable />
    </RequirePermission>
  );
}
