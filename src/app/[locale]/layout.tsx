import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";
import { notFound } from "next/navigation";

import "../globals.css";

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
const quadrillion = localFont({
  src: [
    { path: "../../../public/fonts/Quadrillion-Sb.woff2", weight: "600", style: "normal" },
    { path: "../../../public/fonts/Quadrillion-SbIt.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-quadrillion",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Poppins", "ui-rounded", "system-ui", "sans-serif"],
});

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
const baloo = localFont({
  src: [
    { path: "../../../public/fonts/BalooBhaijaan2-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../public/fonts/BalooBhaijaan2-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../../public/fonts/BalooBhaijaan2-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../../public/fonts/BalooBhaijaan2-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../../public/fonts/BalooBhaijaan2-ExtraBold.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-baloo",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["Segoe UI", "Tahoma", "sans-serif"],
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

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
      className={`${quadrillion.variable} ${baloo.variable} ${inter.variable} ${instrument.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-paper text-ink min-h-screen antialiased">
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
