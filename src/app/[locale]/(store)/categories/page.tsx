import type { Metadata } from "next";

import { getCategories, getFeaturedProducts } from "@/lib/catalog";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { ProductRail } from "@/components/product/ProductRail";
import { PageIntro } from "@/components/ui/PageIntro";
import { SectionHeading } from "@/components/ui/SectionHeading";
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
  return { title: t.nav.categories, description: t.categories.body };
}

export const revalidate = 3600;

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  const [categories, featured] = await Promise.all([getCategories(), getFeaturedProducts(8)]);

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={t.categories.eyebrow}
        title={t.categories.title}
        description={t.categories.body}
      />

      <div className="ns-container">
        <CategoryGrid categories={categories} locale={locale} />
      </div>

      <section className="ns-container py-20 md:py-28">
        <SectionHeading
          locale={locale}
          eyebrow={t.categories.acrossEyebrow}
          title={t.categories.acrossTitle}
          action={{ label: t.common.shopAll, href: "/shop" }}
        />
        <ProductRail products={featured} locale={locale} />
      </section>
    </>
  );
}
