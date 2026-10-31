import type { Metadata } from "next";
import { CouponsManager } from "@/components/coupons/CouponsManager";
import { PageHeader } from "@/components/PageHeader";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Coupons" };

export default function CouponsPage() {
  return (
    <RequirePermission perm="coupon:write" label="Coupons">
      <PageHeader
        eyebrow="Marketing"
        title="Coupons"
        description="Percent, fixed-amount and free-shipping codes. Codes that have been used are deactivated rather than deleted."
      />
      <CouponsManager />
    </RequirePermission>
  );
}
