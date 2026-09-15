import type { Metadata } from "next";

import {
  getActiveOffers,
  getAllProducts,
  getCrossSellIndex,
  getShippingClasses,
  getShippingMethods,
  getTrendingProducts,
} from "@/lib/catalog";
import { categoryPathsFor } from "@/lib/offers";
import { CartPageClient } from "@/components/cart/CartPageClient";
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
  return { title: t.cart.yourBag, robots: { index: false, follow: false } };
}

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  const [shippingMethods, shippingClasses, offers, suggestions, crossSell, products] =
    await Promise.all([
      getShippingMethods(),
      getShippingClasses(),
      getActiveOffers(),
      getTrendingProducts(8),
      getCrossSellIndex(),
      getAllProducts(),
    ]);

  return (
    <>
      <PageIntro locale={locale} eyebrow={t.cart.checkout} title={t.cart.yourBag} />
      <CartPageClient
        shippingMethods={shippingMethods}
        shippingClasses={shippingClasses}
        offers={offers}
        suggestions={suggestions}
        crossSell={crossSell}
        categoryPaths={categoryPathsFor(products)}
        locale={locale}
      />
    </>
  );
}
