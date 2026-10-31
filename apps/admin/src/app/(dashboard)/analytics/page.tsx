import type { Metadata } from "next";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { PageHeader } from "@/components/PageHeader";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <RequirePermission perm="analytics:read" label="Analytics">
      <PageHeader
        eyebrow="Performance"
        title="Analytics"
        description="Sales for any range of up to 366 days, compared with the period just before it. Days are in UTC."
      />
      <AnalyticsDashboard />
    </RequirePermission>
  );
}
