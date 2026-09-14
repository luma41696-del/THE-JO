import NextLink from "next/link";

import "./globals.css";

/**
 * Root not-found.
 *
 * This renders inside the passthrough root layout, which has no `<html>`, so
 * it has to supply the document itself. It is only reached for paths that never
 * matched a locale segment at all — an unshipped language like `/de/shop`, or a
 * request that bypassed the middleware. Everything reached from inside the app
 * hits the localised `app/[locale]/not-found.tsx` instead.
 *
 * Deliberately bilingual and dependency-free: at this point we do not know
 * which language the visitor reads.
 */
export default function RootNotFound() {
  return (
    <html lang="en" dir="ltr">
      <body className="bg-paper text-ink min-h-screen antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
          <svg viewBox="0 0 120 120" width="88" height="88" fill="none" aria-hidden="true">
            <circle cx="60" cy="60" r="46" fill="#FBE7E5" />
            <circle cx="60" cy="60" r="10" fill="#CE1212" />
          </svg>

          <div>
            <p className="font-display text-ink text-2xl font-semibold tracking-tight">
              We do not have this page
            </p>
            <p lang="ar" dir="rtl" className="font-arabic text-smoke mx-auto mt-2 text-lg">
              هذه الصفحة غير موجودة
            </p>
          </div>

          {/* Plain `next/link`, not the locale-aware wrapper: this page sits
              outside the `[locale]` tree, so there is no active locale to
              inherit and these hrefs are already absolute. */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <NextLink
              href="/en"
              className="font-display rounded-pill bg-ink px-7 py-3 text-[0.8125rem] font-semibold tracking-[0.06em] text-white uppercase"
            >
              English
            </NextLink>
            <NextLink
              href="/ar"
              lang="ar"
              className="font-arabic rounded-pill border-line text-ink border px-7 py-3 text-[0.9375rem]"
            >
              العربية
            </NextLink>
          </div>
        </main>
      </body>
    </html>
  );
}
