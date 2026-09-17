import type { Metadata } from "next";
import { Suspense } from "react";

import { UnsubscribeForm } from "@/components/account/UnsubscribeForm";
import { isLocale } from "@/lib/i18n/config";
import type { Locale } from "@/types";

/**
 * Where an unsubscribe link lands.
 *
 * In the focused shell — no navigation, no footer. Somebody who came here came
 * to do one thing, and offering them the shop's menu on the way is the kind of
 * cleverness that turns an unsubscribe into a spam complaint.
 *
 * `noindex`: the URL carries an address and a token.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const rtl = (isLocale(raw) ? raw : "en") === "ar";
  return {
    title: rtl ? "إلغاء الاشتراك" : "Unsubscribe",
    robots: { index: false, follow: false },
  };
}

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";

  // The form reads `?e=` and `?t=` via `useSearchParams`, which needs a
  // Suspense boundary around it.
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <UnsubscribeForm locale={locale} />
    </Suspense>
  );
}
