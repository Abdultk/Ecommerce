import type { Metadata } from "next";
import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission perm="order:read" label="Orders">
      <OrderDetailView id={id} />
    </RequirePermission>
  );
}
