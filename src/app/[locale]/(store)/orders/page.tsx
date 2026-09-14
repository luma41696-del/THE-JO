import type { Metadata } from "next";

import { OrdersList } from "@/components/account/OrdersList";
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
  return { title: t.orders.title, robots: { index: false, follow: false } };
}

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={t.orders.eyebrow}
        title={t.orders.title}
        description={t.orders.body}
      />
      <RequireAuth locale={locale}>
        <OrdersList locale={locale} />
      </RequireAuth>
    </>
  );
}
