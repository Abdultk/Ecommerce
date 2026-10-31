import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ReportsManager } from "@/components/reports/ReportsManager";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <RequirePermission perm="analytics:export" label="Reports">
      <PageHeader
        eyebrow="Exports"
        title="Reports"
        description="CSV and Excel exports run in the background. Download links are short-lived; ask for a new one if it has expired."
      />
      <ReportsManager />
    </RequirePermission>
  );
}
