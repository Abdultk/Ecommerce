import type { Metadata } from "next";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { PageHeader } from "@/components/PageHeader";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage() {
  return (
    <RequirePermission perm="inventory:read" label="Inventory">
      <PageHeader
        eyebrow="Stock"
        title="Inventory"
        description="Stock per variant, lowest available first. Every adjustment is recorded in the ledger with a reason."
      />
      <InventoryTable />
    </RequirePermission>
  );
}
