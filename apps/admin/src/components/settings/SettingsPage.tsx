"use client";

import { useStoreSettings } from "@/lib/store-settings";
import { errorMessage } from "@/lib/session";
import { CurrencyPanel } from "./CurrencyPanel";
import { GeneralSettingsForm } from "./GeneralSettingsForm";
import { PaymentsSettingsForm } from "./PaymentsSettingsForm";
import { SettingsSection, useCanWriteSettings } from "./shared";
import { ShippingSettingsForm } from "./ShippingSettingsForm";

export function SettingsPage() {
  const query = useStoreSettings();
  const canWrite = useCanWriteSettings();
  if (query.isPending) return <p className="text-sm text-muted">Loading settings…</p>;
  if (query.isError || !query.data) {
    return (
      <p role="alert" className="error-text panel p-4">
        {errorMessage(query.error)}
      </p>
    );
  }
  const settings = query.data;
  return (
    <div className="space-y-6">
      {!canWrite && (
        <p className="panel p-4 text-sm text-muted">
          You can view these settings. Only a super admin can change them.
        </p>
      )}
      <SettingsSection title="General" description="The name shown to customers and the VAT rate.">
        <GeneralSettingsForm settings={settings} />
      </SettingsSection>
      <CurrencyPanel currency={settings.currency} />
      <SettingsSection
        title="Shipping"
        description={`Rates and delivery times in ${settings.currency}. Customers see these at checkout.`}
      >
        <ShippingSettingsForm settings={settings} />
      </SettingsSection>
      <SettingsSection
        title="Payments"
        description="Choose how customers can pay. Card payments go through Amwal Pay. Bank transfers are confirmed by hand, within the hold time."
      >
        <PaymentsSettingsForm settings={settings} />
      </SettingsSection>
    </div>
  );
}
