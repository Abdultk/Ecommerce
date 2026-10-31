import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ProfilePage } from "@/components/profile/ProfilePage";

export const metadata: Metadata = { title: "Your profile" };

/** Every signed-in staff member can manage their own account. */
export default function ProfileRoute() {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Your profile"
        description="Your name, password and signed-in devices."
      />
      <ProfilePage />
    </>
  );
}
