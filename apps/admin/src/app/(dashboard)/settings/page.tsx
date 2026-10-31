import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsRoute() {
  return (
    <RequirePermission perm="settings:read" label="Settings">
      <PageHeader
        eyebrow="Store"
        title="Store settings"
        description="The store's name, currency, VAT, shipping and payment methods. Every change is written to the audit log."
      />
      <SettingsPage />
    </RequirePermission>
  );
}
