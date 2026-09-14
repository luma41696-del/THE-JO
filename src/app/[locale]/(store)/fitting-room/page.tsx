import type { Metadata } from "next";

import { getAllProducts } from "@/lib/catalog";
import { FittingRoom } from "@/components/fitting/FittingRoom";
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
  return { title: t.fitting.eyebrow, description: t.fitting.pageBody };
}

export default async function FittingRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const [{ locale: raw }, { product }] = await Promise.all([params, searchParams]);
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  const products = await getAllProducts();

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={t.fitting.eyebrow}
        title={t.fitting.pageTitle}
        description={t.fitting.pageBody}
      />
      <FittingRoom products={products} initialSlug={product} locale={locale} />
    </>
  );
}
