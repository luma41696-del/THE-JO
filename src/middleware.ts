import { NextResponse, type NextRequest } from "next/server";

import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  isLocalisedPath,
  negotiateLocale,
} from "@/lib/i18n/config";

/**
 * Locale routing.
 *
 * Every page lives under `/en/…` or `/ar/…`. A request without a locale prefix
 * is redirected to one, chosen in this order:
 *
 *   1. the `NEXT_LOCALE` cookie — a returning shopper's explicit choice, which
 *      must outrank their browser's configuration;
 *   2. the `Accept-Language` header;
 *   3. English.
 *
 * The redirect is a 307, not a 308: the chosen locale depends on the request,
 * so it must not be cached by the browser as permanent.
 */

const PUBLIC_FILE = /\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|json|txt|xml|woff2?|ttf|otf|webmanifest)$/i;

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Never touch Next internals, static files, or anything outside the
  // localised tree. That last rule is defined once in `isLocalisedPath` and
  // shared with the `Link` wrapper, so the two cannot drift apart — they did
  // once, and every `/admin` link became `/en/admin` and 404'd.
  if (
    !isLocalisedPath(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/_vercel") ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const first = pathname.split("/")[1];

  if (isLocale(first)) {
    // Already localised. Remember the choice so the next bare URL lands in the
    // same language, and expose it to Server Components that want it without
    // re-parsing the path.
    const response = NextResponse.next();
    if (request.cookies.get("NEXT_LOCALE")?.value !== first) {
      response.cookies.set("NEXT_LOCALE", first, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    response.headers.set("x-ns-locale", first);
    return response;
  }

  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : negotiateLocale(request.headers.get("accept-language"));

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  url.search = search;

  return NextResponse.redirect(url, 307);
}

export const config = {
  /**
   * Skip the middleware entirely for assets. Matching then re-checking inside
   * the handler still costs an invocation per request, and image requests are
   * the bulk of the traffic on a fashion storefront.
   */
  matcher: ["/((?!api|admin|_next/static|_next/image|favicon.ico|brand|demo|fonts|lottie).*)"],
};

export const runtime = "nodejs";

/** Re-exported so the constant has one home. */
export { LOCALES, DEFAULT_LOCALE };
