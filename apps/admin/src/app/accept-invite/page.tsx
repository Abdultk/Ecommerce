import type { Metadata } from "next";
import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";

export const metadata: Metadata = { title: "Accept invite", referrer: "no-referrer" };

export default function AcceptInvitePage() {
  return <AcceptInviteForm />;
}
