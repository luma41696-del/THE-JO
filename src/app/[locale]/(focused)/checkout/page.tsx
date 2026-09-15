import type { Metadata } from "next";

import {
  getActiveOffers,
  getAllProducts,
  getShippingClasses,
  getShippingMethods,
} from "@/lib/catalog";
import { categoryPathsFor } from "@/lib/offers";
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

  const [shippingMethods, shippingClasses, offers, products] = await Promise.all([
    getShippingMethods(),
    getShippingClasses(),
    getActiveOffers(),
    getAllProducts(),
  ]);

  return (
    <CheckoutFlow
      shippingMethods={shippingMethods}
      shippingClasses={shippingClasses}
      offers={offers}
      categoryPaths={categoryPathsFor(products)}
      locale={locale}
    />
  );
}
