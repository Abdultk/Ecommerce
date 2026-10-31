import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PAISLEY art Admin", template: "%s · PAISLEY art Admin" },
  description: "Back-office dashboard for PAISLEY art staff.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export const viewport: Viewport = { themeColor: "#14110f" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading request headers makes every page render per request, which the
  // nonce-based CSP set in middleware requires (Next applies the nonce itself).
  await headers();
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
