import type { Metadata } from "next";

import { OrderTracking } from "@/components/account/OrderTracking";
import { RequireAuth } from "@/components/account/RequireAuth";
import { PageIntro } from "@/components/ui/PageIntro";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const t = getDictionary(isLocale(raw) ? raw : "en");
  return { title: t.orders.trackingTitle, robots: { index: false, follow: false } };
}

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ reference: string; locale: string }>;
}) {
  const { reference, locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={t.orders.trackingEyebrow}
        title={t.orders.trackingTitle}
      />
      <RequireAuth locale={locale}>
        {/* The order is fetched on the client so the read carries the
            customer's own auth token and is checked by Security Rules. */}
        <OrderTracking reference={reference} locale={locale} />
      </RequireAuth>
    </>
  );
}
