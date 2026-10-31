import type { Metadata } from "next";
import { TwoFactorForm } from "@/components/auth/TwoFactorForm";

export const metadata: Metadata = { title: "Verify sign-in" };

export default function TwoFactorPage() {
  return <TwoFactorForm />;
}
