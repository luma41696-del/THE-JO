import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getCategories,
  getProductBySlug,
  getBoughtWith,
  getProductReviews,
  getReviewSummary,
  getShippingClasses,
  getShopProducts,
  getUpsellProducts,
} from "@/lib/catalog";
import { getStoreSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { breadcrumbList, productCrumbs } from "@/lib/seo";
import { similarTo } from "@/lib/visual-search";
import { categoryTrail } from "@/lib/categories";
import { ProductDetail } from "@/components/product/ProductDetail";
import { ProductRail } from "@/components/product/ProductRail";
import { UpsellRail } from "@/components/product/UpsellRail";
import { ProductReviews } from "@/components/product/ProductReviews";
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
  // Only visible products are pre-rendered; a hidden one resolves through
  // `getProductBySlug`, finds nothing, and 404s.
  const products = await getShopProducts();
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
      title: `${title} · net sale`,
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

  const [related, upsells, categories, shippingClasses, reviews, reviewSummary, settings] =
    await Promise.all([
      getBoughtWith(product, 8),
      getUpsellProducts(product),
      getCategories(),
      getShippingClasses(),
      getProductReviews(product.id),
      getReviewSummary(product.id),
      getStoreSettings(),
    ]);

  /*
   * Matched on colour, from the catalogue already loaded — no second read,
   * and nothing shown that the bought-with rail is already showing.
   */
  const allProducts = await getShopProducts();
  const shownAlready = new Set([product.id, ...related.map((p) => p.id)]);
  const similar = similarTo(product, allProducts, 8).filter(
    (candidate) => !shownAlready.has(candidate.id),
  );

  const trail = categoryTrail(categories, product.categoryId);
  const shippingClass =
    shippingClasses.find((c) => c.id === product.shippingClassId) ?? null;

  /**
   * Product structured data. Worth the few lines: it is what produces the price
   * and rating chips in search results, which measurably lifts click-through on
   * product queries.
   */
  // Absolute, always. A relative URL in JSON-LD validates as present and is
  // useless to a search engine.
  const url = absoluteUrl(`${locale}/product/${product.slug}`);

  /*
   * A variable product publishes one Offer per variant, each with its own SKU,
   * GTIN and availability. A single parent Offer would claim one barcode for
   * every size — Merchant Center rejects that outright, and the sizes that are
   * sold out would still advertise as in stock.
   */
  const offers =
    product.type === "variable" && product.variants?.length
      ? product.variants.map((variant) => ({
          "@type": "Offer",
          sku: variant.sku,
          ...(variant.gtin ? { gtin: variant.gtin } : {}),
          price: variant.priceOverride ?? product.price,
          priceCurrency: product.currency,
          availability:
            variant.stock > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          url,
        }))
      : {
          "@type": "Offer",
          sku: product.sku,
          ...(product.gtin ? { gtin: product.gtin } : {}),
          price: product.price,
          priceCurrency: product.currency,
          availability: product.inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url,
        };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: pick(product.title, locale),
    description: pick(product.description, locale),
    image: product.images.map((i) => i.url),
    sku: product.sku,
    ...(product.gtin ? { gtin: product.gtin } : {}),
    brand: { "@type": "Brand", name: "net sale" },
    ...(trail.length > 0
      ? { category: trail.map((c) => pick(c.name, locale)).join(" > ") }
      : {}),
    offers,
    /*
     * The aggregate rating comes from published reviews, not from the
     * `rating` field seeded with the demo catalogue. Publishing a rating
     * nobody wrote is a fabricated review snippet in Google's results — the
     * kind of structured-data claim that gets a site's rich results pulled,
     * and rightly so. With no reviews, the property is absent.
     */
    ...(reviewSummary.count > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: reviewSummary.average,
            reviewCount: reviewSummary.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Serialised from our own catalogue data, never from user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            jsonLd,
            breadcrumbList(productCrumbs(product, trail, locale, "net sale"), locale),
          ]),
        }}
      />

      <ProductDetail
        product={product}
        locale={locale}
        trail={trail}
        shippingClass={shippingClass}
        reviewSummary={reviewSummary}
        settings={settings}
      />

      <ProductReviews
        productId={product.id}
        productTitle={pick(product.title, locale)}
        summary={reviewSummary}
        reviews={reviews}
        locale={locale}
      />

      {/*
        Upsells sit directly under the product, before the "wear it with" rail.
        An upsell competes with the thing being viewed, so it has to appear
        while the decision is still open — after the related-products rail, the
        customer has already moved on to browsing.
      */}
      {upsells.length > 0 && <UpsellRail products={upsells} current={product} locale={locale} />}

      {related.length > 0 && (
        <section className="ns-container pb-20 md:pb-28">
          <SectionHeading
            locale={locale}
            eyebrow={t.product.wearItWith}
            title={t.product.completesLook}
            action={{ label: t.common.shopAll, href: "/shop" }}
          />
          <ProductRail products={related} locale={locale} />
        </section>
      )}

      {/*
        Pieces in the same colours.

        A different question from the rail above it, which answers "what was
        bought with this". This one answers "what else looks like this", and
        the two disagree often enough to both be worth showing — a customer who
        liked the shade and not the shape is not served by what other people
        put in the same basket.

        Deduplicated against that rail rather than shown regardless: two rails
        listing the same four pieces reads as the page having run out of ideas.
      */}
      {similar.length > 0 && (
        <section className="ns-container pb-20 md:pb-28">
          <SectionHeading
            locale={locale}
            eyebrow={locale === "ar" ? "بالألوان نفسها" : "In these colours"}
            title={locale === "ar" ? "قطع مشابهة" : "Similar pieces"}
          />
          <ProductRail products={similar} locale={locale} />
        </section>
      )}
    </>
  );
}
