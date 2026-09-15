import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";

import "../globals.css";

import { AuthProvider } from "@/components/providers/AuthProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { AdminGate } from "@/components/admin/AdminGate";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminLocaleProvider } from "@/components/admin/AdminLocale";
import { getAdminOrders } from "@/lib/admin/data";
import { requireAdminSession } from "@/lib/firebase/session";

/**
 * Admin shell.
 *
 * Deliberately outside the `[locale]` tree: operations tooling is read by the
 * team, not by shoppers. `middleware.ts` skips `/admin` so it is never
 * redirected into a localised path.
 *
 * It still provides `LocaleProvider` — fixed to English — because shared
 * components (`Link`, `Button`, price formatting) read from it, and because
 * prices and dates in an operations tool should not change shape with the
 * operator's reading language. `AdminLocaleProvider` carries that separately:
 * the operator's language is a preference on their machine, not part of the
 * URL the way a shopper's is.
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

/**
 * Cairo — the admin's one typeface, in both languages.
 *
 * The storefront keeps its own faces; the brand identity is not up for
 * revision. Operations is a different room: it is read for hours at a time, in
 * two scripts, by people switching between them mid-shift, and the previous
 * arrangement did not serve that.
 *
 * It was also quietly broken. `globals.css` swaps the body face for Arabic
 * with `[dir="rtl"] body`, and the admin sets its direction on a div *inside*
 * the body — so the selector could never match here, and choosing Arabic gave
 * Arabic text set in a Latin face with Latin metrics. Cairo covers both
 * scripts in one family, which removes the swap rather than repairing it.
 *
 * Six weights because the operator supplied six, and a dense screen uses them:
 * 200/300 for quiet captions, 400 for tables, 600/700 for labels and headings,
 * 900 where a number has to carry a panel.
 *
 * `preload: false` on purpose. This is 340KB behind an authentication gate —
 * not a landing page — and the operator's second screen comes from cache.
 */
const cairo = localFont({
  src: [
    { path: "../../../public/fonts/Cairo-ExtraLight.woff2", weight: "200", style: "normal" },
    { path: "../../../public/fonts/Cairo-Light.woff2", weight: "300", style: "normal" },
    { path: "../../../public/fonts/Cairo-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../public/fonts/Cairo-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../../public/fonts/Cairo-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../../public/fonts/Cairo-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-cairo",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["Segoe UI", "Tahoma", "sans-serif"],
});

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
      className={`${quadrillion.variable} ${baloo.variable} ${inter.variable} ${cairo.variable}`}
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
