import type { Metadata, Viewport } from "next";
import { websiteJsonLd } from "@/lib/seo";
import { Instrument_Serif } from "next/font/google";
import { notFound } from "next/navigation";

import "../globals.css";

import { fontVariables } from "../fonts";

import { AuthProvider } from "@/components/providers/AuthProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { BrandCursor } from "@/components/cursor/BrandCursor";
import { BrandIntro } from "@/components/brand/BrandIntro";
import { LOCALES, LOCALE_META, isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { absoluteUrl, siteUrl } from "@/lib/site";
import type { Locale } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Type                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Quadrillion — the logo face, supplied with the brand artwork.
 *
 * Reserved for the wordmark and display headings, and Latin-only: it carries no
 * Arabic glyphs, which is exactly why `--font-display` lists Baloo after it.
 * The browser's per-glyph fallback then sets Arabic headings in Baloo with no
 * conditional CSS at all.
 */


/**
 * Baloo Bhaijaan 2 — the bilingual workhorse.
 *
 * Covers Arabic and Latin in one family, so it can carry all Arabic copy *and*
 * the interface chrome in English without the two languages looking like two
 * different products. Its rounded geometry also sits naturally beside the
 * pebble mark.
 *
 * `preload: false` is deliberate. Five weights with full Arabic coverage is
 * ~300KB; preloading all of them would block first paint to fetch weights a
 * page may never use. Without preload the browser requests only the faces its
 * rendered text actually matches, and `swap` keeps text visible meanwhile. The
 * files carry a one-year immutable cache, so the cost is paid once.
 */


/** Editorial accents only — pull quotes, campaign titles, the 404. */
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument",
  display: "swap",
});

/* -------------------------------------------------------------------------- */
/*  Metadata                                                                  */
/* -------------------------------------------------------------------------- */

// One source for the shop's own address — see `lib/site.ts`.

export async function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);
  const meta = LOCALE_META[locale];

  const title = `${t.brand.name} — ${locale === "ar" ? "net sale" : "نت سيل"} | ${t.brand.tagline}`;

  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${t.brand.name}` },
    description: t.brand.taglineLong,
    applicationName: "net sale",
    keywords:
      locale === "ar"
        ? ["أزياء", "نت سيل", "ملابس", "الأردن", "غرفة القياس", "تسوق"]
        : ["fashion", "premium", "net sale", "Jordan", "AI fitting room", "luxury basics"],
    openGraph: {
      type: "website",
      siteName: "net sale — نت سيل",
      title,
      description: t.brand.taglineLong,
      url: absoluteUrl(locale),
      locale: meta.ogLocale,
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => LOCALE_META[l].ogLocale),
    },
    twitter: { card: "summary_large_image", title, description: t.brand.tagline },
    icons: {
      icon: [{ url: "/brand/net-sale-icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/brand/net-sale-icon.svg" }],
    },
    /**
     * `hreflang` for both languages plus `x-default`. Without these, Google
     * treats /en and /ar as competing duplicates rather than as translations
     * and picks one to index.
     */
    alternates: {
      canonical: `/${locale}`,
      languages: {
        "en-JO": "/en",
        "ar-JO": "/ar",
        "x-default": "/en",
      },
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eeebdd" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1717" },
  ],
  width: "device-width",
  initialScale: 1,
  // Never block zoom — an accessibility failure, not a design choice.
  maximumScale: 5,
};

/* -------------------------------------------------------------------------- */

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  // A path like /de/shop matched the segment but is not a language we ship.
  if (!isLocale(raw)) notFound();

  const locale: Locale = raw;
  const meta = LOCALE_META[locale];
  const t = getDictionary(locale);

  return (
    <html
      lang={meta.tag}
      dir={meta.dir}
      className={`${fontVariables} ${instrument.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-paper text-ink min-h-screen antialiased">
        {/*
          The shop itself, and how to search it.

          On the layout rather than the home page so it is present on every
          entry point — a crawler can arrive at any URL, and a site that only
          declares itself on one page declares itself to whoever happens to
          land there. The search template points at the real /shop?q=, which
          the listing now serves; a SearchAction whose target 404s is worse
          than none, because it offers a search box that leads nowhere.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteJsonLd(locale, "net sale")),
          }}
        />

        {/* First focusable element on the page, by design. */}
        <a
          href="#main"
          className="bg-ink focus:rounded-md sr-only px-4 py-2 text-white focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[400]"
        >
          {t.common.skipToContent}
        </a>

        {/* The locale layout owns only what every route needs: language, the
            session, the brand curtain and the cursor. Chrome lives in the route
            groups — `(store)` has the full shell, `(focused)` has none. */}
        <LocaleProvider locale={locale}>
          <AuthProvider>
            <BrandIntro />
            <BrandCursor />

            <main id="main">{children}</main>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
