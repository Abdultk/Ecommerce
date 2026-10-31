import type { Metadata } from "next";
import { AuditLogViewer } from "@/components/audit/AuditLogViewer";
import { PageHeader } from "@/components/PageHeader";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditLogPage() {
  return (
    <RequirePermission perm="audit:read" label="Audit log">
      <PageHeader
        eyebrow="Security"
        title="Audit log"
        description="Every admin change, with who made it and the record before and after."
      />
      <AuditLogViewer />
    </RequirePermission>
  );
}
