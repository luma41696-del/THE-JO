import {
  getBanners,
  getSlotSettings,
  getCategoryTree,
  getDiscountedProducts,
  getFeaturedProducts,
  getNewArrivals,
  getTestimonials,
  getTrendingProducts,
} from "@/lib/catalog";
import { HeroBanner } from "@/components/home/HeroBanner";
import { PromoRail } from "@/components/home/PromoRail";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { BrandStory } from "@/components/home/BrandStory";
import { FittingRoomTeaser } from "@/components/home/FittingRoomTeaser";
import { Testimonials } from "@/components/home/Testimonials";
import { Newsletter } from "@/components/home/Newsletter";
import { ProductRail } from "@/components/product/ProductRail";
import { ProductGrid } from "@/components/product/ProductGrid";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Link } from "@/components/ui/Link";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/types";

/**
 * Homepage.
 *
 * A Server Component end to end: every section's data is fetched here and
 * passed down, so the page streams as HTML with product imagery already in the
 * markup. Only the sections that genuinely need interactivity (hero parallax,
 * rails, the fitting-room demo) are Client Components, and they receive both
 * their data *and* the locale as props rather than fetching or inferring either.
 *
 * Section order follows intent, not novelty:
 *   hero → campaigns → new in → categories → featured → fitting room
 *        → offers → trending → brand story → reviews → newsletter
 * Shop early, story late: a first-time visitor needs product before philosophy.
 */

// The catalogue changes a few times a day at most; revalidate hourly and let
// a webhook from the CMS/Firestore trigger `revalidatePath` for urgent edits.
export const revalidate = 3600;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  const [
    heroBanners,
    promoBanners,
    spotlight,
    heroSlot,
    newArrivals,
    featured,
    trending,
    offers,
    categories,
    testimonials,
  ] = await Promise.all([
    getBanners("hero"),
    getBanners("promo-rail"),
    getBanners("spotlight"),
    getSlotSettings("hero"),
    getNewArrivals(10),
    getFeaturedProducts(8),
    getTrendingProducts(10),
    getDiscountedProducts(4),
    getCategoryTree(),
    getTestimonials(),
  ]);

  const campaignCards = [...promoBanners, ...spotlight];

  return (
    <>
      {/*
        The hero is whatever the merchant has scheduled — or nothing at all.
        `heroSlot.enabled` turns the placement off without touching the banners
        in it, which is the difference between "this campaign is over" and
        "we are not running a hero this month".
      */}
      <HeroBanner
        banners={heroSlot.enabled ? heroBanners : []}
        display={heroSlot.display}
        interval={heroSlot.interval}
        locale={locale}
        fallbackHeading={t.brand.taglineLong ? t.brand.tagline : t.brand.name}
      />

      {/* --- Campaigns / advertising rail --------------------------------- */}
      <section className="ns-container py-16 md:py-24">
        <SectionHeading
          eyebrow={t.home.campaignsEyebrow}
          title={t.home.campaignsTitle}
          description={t.home.campaignsBody}
          action={{ label: t.home.allOffers, href: "/shop?onSale=true" }}
          locale={locale}
        />
        <PromoRail banners={campaignCards} locale={locale} />
      </section>

      {/* --- New arrivals -------------------------------------------------- */}
      <section className="ns-container py-16 md:py-24">
        <SectionHeading
          eyebrow={t.home.newArrivalsEyebrow}
          title={t.home.newArrivalsTitle}
          action={{ label: t.common.viewAll, href: "/shop?sort=newest" }}
          locale={locale}
        />
        <ProductRail products={newArrivals} locale={locale} />
      </section>

      {/* --- Categories ---------------------------------------------------- */}
      <section className="ns-container py-16 md:py-24">
        <SectionHeading
          eyebrow={t.home.categoriesEyebrow}
          title={t.home.categoriesTitle}
          description={t.home.categoriesBody}
          locale={locale}
        />
        <CategoryGrid categories={categories} locale={locale} />
      </section>

      {/* --- Featured ------------------------------------------------------ */}
      <section className="ns-container py-16 md:py-24">
        <SectionHeading
          eyebrow={t.home.featuredEyebrow}
          title={t.home.featuredTitle}
          action={{ label: t.common.shopAll, href: "/shop" }}
          locale={locale}
        />
        <ProductGrid products={featured} locale={locale} columns={4} />
      </section>

      {/* --- AI fitting room ----------------------------------------------- */}
      <section className="ns-container py-16 md:py-24">
        <FittingRoomTeaser products={featured} locale={locale} />
      </section>

      {/* --- Offers -------------------------------------------------------- */}
      {offers.length > 0 && (
        <section className="ns-container py-16 md:py-24">
          <SectionHeading
            eyebrow={t.home.offersEyebrow}
            title={t.home.offersTitle}
            description={t.home.offersBody}
            action={{ label: t.home.allReductions, href: "/shop?onSale=true" }}
            locale={locale}
          />
          <ProductGrid products={offers} locale={locale} columns={4} />
        </section>
      )}

      {/* --- Trending ------------------------------------------------------ */}
      <section className="ns-container py-16 md:py-24">
        <SectionHeading
          eyebrow={t.home.trendingEyebrow}
          title={t.home.trendingTitle}
          action={{ label: t.common.viewAll, href: "/shop?sort=rating" }}
          locale={locale}
        />
        <ProductRail products={trending} locale={locale} />
      </section>

      {/* --- Brand story --------------------------------------------------- */}
      <section className="ns-container py-16 md:py-28">
        <BrandStory locale={locale} />
      </section>

      {/* --- Reviews ------------------------------------------------------- */}
      <section className="ns-container py-16 md:py-24">
        <SectionHeading
          eyebrow={t.home.reviewsEyebrow}
          title={t.home.reviewsTitle}
          align="center"
          locale={locale}
        />
        <Testimonials testimonials={testimonials} locale={locale} />
      </section>

      {/* --- Newsletter ---------------------------------------------------- */}
      <section className="ns-container py-8 md:py-16">
        <Newsletter locale={locale} />
      </section>

      {/* --- Closing CTA --------------------------------------------------- */}
      <section className="ns-container pt-8 pb-20 text-center md:pb-28">
        <Reveal>
          <p
            className={
              locale === "ar"
                ? "font-arabic text-ink mx-auto max-w-2xl text-2xl text-balance md:text-4xl"
                : "font-editorial text-ink mx-auto max-w-2xl text-3xl text-balance italic md:text-5xl"
            }
          >
            {t.home.closingLine}
          </p>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/shop">
              <Button variant="primary" size="lg" magnetic>
                {t.home.shopCollection}
              </Button>
            </Link>
            <Link href="/about">
              <Button variant="ghost" size="lg">
                {t.home.ourStory}
              </Button>
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
