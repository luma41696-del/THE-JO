import type { Metadata } from "next";

import { getActiveOffers, getShippingMethods } from "@/lib/catalog";
import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";
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
  return { title: t.cart.checkout, robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";

  const [shippingMethods, offers] = await Promise.all([getShippingMethods(), getActiveOffers()]);

  return <CheckoutFlow shippingMethods={shippingMethods} offers={offers} locale={locale} />;
}
