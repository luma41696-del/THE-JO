import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";

import "../globals.css";

import { AuthProvider } from "@/components/providers/AuthProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { AdminGate } from "@/components/admin/AdminGate";
import { AdminShell } from "@/components/admin/AdminShell";
import { getAdminOrders } from "@/lib/admin/data";
import { requireAdminSession } from "@/lib/firebase/session";

/**
 * Admin shell.
 *
 * Deliberately outside the `[locale]` tree: operations tooling is read by the
 * team, not by shoppers, and a half-translated admin is worse than one language
 * done properly. `middleware.ts` skips `/admin` so it is never redirected into
 * a localised path.
 *
 * It still provides `LocaleProvider` — fixed to English — because shared
 * components (`Link`, `Button`, price formatting) read from it. Without the
 * provider those would throw.
 *
 * No brand curtain and no custom cursor here. Both are storefront theatre; an
 * operator processing forty orders wants the system pointer and no interstitial.
 */

const quadrillion = localFont({
  src: [{ path: "../../../public/fonts/Quadrillion-Sb.woff2", weight: "600", style: "normal" }],
  variable: "--font-quadrillion",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Poppins", "ui-rounded", "system-ui", "sans-serif"],
});

const baloo = localFont({
  src: [
    { path: "../../../public/fonts/BalooBhaijaan2-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../public/fonts/BalooBhaijaan2-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-baloo",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["Segoe UI", "Tahoma", "sans-serif"],
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Operations · THE JO", template: "%s · THE JO Operations" },
  // Internal tooling must never be indexed, and the link must not leak either.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminSession();
  // Resolved once here so the shell can tell the operator when a screen is
  // showing generated data rather than their real Firestore orders.
  const { live } = await getAdminOrders();

  return (
    <html
      lang="en"
      dir="ltr"
      className={`${quadrillion.variable} ${baloo.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-paper text-ink min-h-screen antialiased">
        <LocaleProvider locale="en">
          <AuthProvider>
            <AdminGate>
              <AdminShell live={live}>{children}</AdminShell>
            </AdminGate>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
