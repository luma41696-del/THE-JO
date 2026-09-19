import { NextResponse, type NextRequest } from "next/server";

import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  isLocalisedPath,
  negotiateLocale,
} from "@/lib/i18n/config";
import { clientIp } from "@/lib/security/ip";
import { blockFor } from "@/lib/security/ip-blocks";

/**
 * Blocked addresses, then locale routing.
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

/**
 * The page a blocked visitor gets.
 *
 * Deliberately not the shop's own 403 route: rendering a React page would
 * hand somebody being kept out a Next.js render on every request, which is
 * exactly the load a block is meant to shed. This is a string.
 *
 * It does not say why, and it does not name the rule. Somebody probing what
 * the shop blocks and how wide the range is learns nothing from it, and a
 * person blocked by mistake is given the one thing that helps — an address to
 * write to.
 */
function blockedPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>الوصول محجوب</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f1e6;font:15px/1.7 'Segoe UI',Tahoma,Arial,sans-serif;color:#14110f;padding:24px">
<div style="max-width:420px;text-align:center">
<p style="font-weight:700;letter-spacing:.02em;margin:0 0 20px">Net Sale</p>
<h1 style="font-size:19px;margin:0 0 10px">لا يمكن الوصول إلى المتجر من هذا الاتصال</h1>
<p style="color:#6f6862;font-size:14px;margin:0 0 6px">This shop cannot be reached from this connection.</p>
<p style="color:#6f6862;font-size:13px;margin:18px 0 0">إن كنت تظن أن هذا خطأ، راسلنا على<br><a href="mailto:hello@netsale.shop" style="color:#d21f26" dir="ltr">hello@netsale.shop</a></p>
</div></body></html>`;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  /*
   * Before anything else, including the static-path bail-out below: a blocked
   * visitor is blocked from the API as much as from the pages, and the API is
   * where the abuse worth blocking actually happens.
   *
   * `blockFor` holds the list in memory for half a minute and fails open, so
   * the cost here is a map lookup on all but the first request of an instance.
   */
  const blocked = await blockFor(clientIp(request.headers));
  if (blocked) {
    const wantsJson =
      pathname.startsWith("/api/") || request.headers.get("accept")?.includes("application/json");

    return wantsJson
      ? NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 })
      : new NextResponse(blockedPage(), {
          status: 403,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
  }

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
   *
   * `api` and `admin` used to be excluded here too, and are not any more: the
   * blocklist has to cover them, and they are the paths worth covering most.
   * Both still fall through `isLocalisedPath` untouched by the locale rules
   * below, so nothing about their routing changed.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand|demo|fonts|lottie).*)",
  ],
};

export const runtime = "nodejs";

/** Re-exported so the constant has one home. */
export { LOCALES, DEFAULT_LOCALE };
