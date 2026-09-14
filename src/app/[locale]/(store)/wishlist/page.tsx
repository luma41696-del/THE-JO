import type { Metadata } from "next";

import { getAllProducts } from "@/lib/catalog";
import { WishlistClient } from "@/components/account/WishlistClient";
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
  return { title: t.wishlist.title, robots: { index: false, follow: false } };
}

export default async function WishlistPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  // The full catalogue is passed down and filtered on the client: the wishlist
  // stores ids only, so prices and stock are always today's, never a snapshot.
  const products = await getAllProducts();

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={t.wishlist.eyebrow}
        title={t.wishlist.title}
        description={t.wishlist.body}
      />
      <WishlistClient products={products} locale={locale} />
    </>
  );
}
