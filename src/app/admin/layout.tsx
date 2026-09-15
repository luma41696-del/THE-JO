import type { Metadata } from "next";

import "../globals.css";

import { fontVariables } from "../fonts";

import { AuthProvider } from "@/components/providers/AuthProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { AdminGate } from "@/components/admin/AdminGate";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminLocaleProvider } from "@/components/admin/AdminLocale";
import { getAdminOrders } from "@/lib/admin/data";
import { requireAdminSession } from "@/lib/firebase/session";

export const metadata: Metadata = {
  title: { default: "Operations · net sale", template: "%s · net sale Operations" },
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
      className={fontVariables}
      suppressHydrationWarning
    >
      {/* `data-admin-root` is what redirects every font token to Cairo — see
          the rule in globals.css. Scoped so the storefront is untouched. */}
      <body data-admin-root className="bg-paper text-ink min-h-screen antialiased">
        <LocaleProvider locale="en">
          <AuthProvider>
            {/*
              The language provider wraps the gate, not the other way round.

              The gate renders the "sign in" and "no access" screens, and those
              are the two screens a locked-out operator sees most — leaving
              them outside the provider meant they were permanently English
              while the rest of the tool had been translated.
            */}
            <AdminLocaleProvider>
              <AdminGate>
                <AdminShell live={live}>{children}</AdminShell>
              </AdminGate>
            </AdminLocaleProvider>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
