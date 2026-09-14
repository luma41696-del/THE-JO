import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAllProducts, getProductBySlug, getRelatedProducts } from "@/lib/catalog";
import { ProductDetail } from "@/components/product/ProductDetail";
import { ProductRail } from "@/components/product/ProductRail";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { LOCALES, isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { t as pick } from "@/lib/format";
import type { Locale } from "@/types";

export const revalidate = 3600;

/**
 * Pre-render every product in every language at build time. The catalogue is
 * small and stable, so the cross-product of 12 products × 2 locales is 24
 * pages — cheap, and it means no shopper ever waits on a cold render.
 */
export async function generateStaticParams() {
  const products = await getAllProducts();
  return LOCALES.flatMap((locale) =>
    products.map((product) => ({ locale, slug: product.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const product = await getProductBySlug(slug);
  if (!product) return { title: "404" };

  const image = product.images[0];
  const title = pick(product.title, locale);
  const description = pick(product.description, locale).slice(0, 160);

  return {
    title,
    description,
    openGraph: {
      title: `${title} · THE JO`,
      description: product.subtitle ? pick(product.subtitle, locale) : description,
      type: "website",
      images: image
        ? [{ url: image.url, width: image.width, height: image.height, alt: image.alt }]
        : [],
    },
    alternates: {
      canonical: `/${locale}/product/${product.slug}`,
      languages: {
        "en-JO": `/en/product/${product.slug}`,
        "ar-JO": `/ar/product/${product.slug}`,
      },
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  const product = await getProductBySlug(slug);
  if (!product || product.status !== "active") notFound();

  const related = await getRelatedProducts(product, 8);

  /**
   * Product structured data. Worth the few lines: it is what produces the price
   * and rating chips in search results, which measurably lifts click-through on
   * product queries.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: pick(product.title, locale),
    description: pick(product.description, locale),
    image: product.images.map((i) => i.url),
    sku: product.id,
    brand: { "@type": "Brand", name: "THE JO" },
    offers: {
      "@type": "Offer",
      price: product.price,
      priceCurrency: product.currency,
      availability: product.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/${locale}/product/${product.slug}`,
    },
    ...(product.rating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.rating.average,
            reviewCount: product.rating.count,
          },
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Serialised from our own catalogue data, never from user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <ProductDetail product={product} locale={locale} />

      {related.length > 0 && (
        <section className="jo-container pb-20 md:pb-28">
          <SectionHeading
            locale={locale}
            eyebrow={t.product.wearItWith}
            title={t.product.completesLook}
            action={{ label: t.common.shopAll, href: "/shop" }}
          />
          <ProductRail products={related} locale={locale} />
        </section>
      )}
    </>
  );
}
