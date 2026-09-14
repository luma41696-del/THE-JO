import type { CurrencyCode, Locale } from "@/types";

/**
 * Locale configuration.
 *
 * Routing is **prefix-always**: `/en/shop` and `/ar/shop`, never a bare
 * `/shop`. The alternative — leaving the default locale unprefixed — saves six
 * characters and costs a duplicate-content problem, an ambiguous root, and a
 * special case in every link helper. One shape for both languages is worth
 * more than a shorter English URL.
 */

export const LOCALES = ["en", "ar"] as const;

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_META: Record<
  Locale,
  {
    /** BCP-47 tag for `Intl` and the `lang` attribute. */
    tag: string;
    dir: "ltr" | "rtl";
    /** Endonym — a language switcher must name a language in that language. */
    label: string;
    /** Short form for the switcher toggle. */
    short: string;
    ogLocale: string;
  }
> = {
  en: { tag: "en-JO", dir: "ltr", label: "English", short: "EN", ogLocale: "en_JO" },
  ar: { tag: "ar-JO", dir: "rtl", label: "العربية", short: "ع", ogLocale: "ar_JO" },
};

/** The store prices in Jordanian dinar. */
export const STORE_CURRENCY: CurrencyCode = "JOD";

export function isLocale(value: string | undefined): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Paths that live outside the localised tree.
 *
 * The admin is internal tooling in one language and the API has no UI, so
 * neither is ever prefixed. This is the single definition of that rule — the
 * middleware, `Link` and `useLocalizedRouter` all read it, so they cannot drift
 * apart. They did drift once: `Link` prefixed `/admin` into `/en/admin` and
 * every admin link 404'd.
 */
const UNLOCALISED = ["/admin", "/api", "/_next"];

export function isLocalisedPath(path: string) {
  return !UNLOCALISED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function localeDir(locale: Locale) {
  return LOCALE_META[locale].dir;
}

export function isRtl(locale: Locale) {
  return LOCALE_META[locale].dir === "rtl";
}

/** The other locale — the switcher is a toggle, not a menu, with two languages. */
export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "ar" : "en";
}

/**
 * Prefix a path with a locale.
 *
 * Accepts an already-prefixed path and re-points it, which is what the language
 * switcher needs: it is handed the current pathname and must produce the same
 * page in the other language.
 */
export function localePath(path: string, locale: Locale) {
  if (!path.startsWith("/")) return `/${locale}/${path}`;

  const segments = path.split("/").filter(Boolean);
  if (isLocale(segments[0])) segments.shift();

  const rest = segments.join("/");
  return rest ? `/${locale}/${rest}` : `/${locale}`;
}

/** Read the locale out of a pathname, falling back to the default. */
export function localeFromPath(path: string): Locale {
  const first = path.split("/").filter(Boolean)[0];
  return isLocale(first) ? first : DEFAULT_LOCALE;
}

/**
 * Best locale for an `Accept-Language` header.
 *
 * Deliberately simple: q-values are parsed, but any Arabic tag wins for Arabic
 * and everything else falls through to English. A full RFC-4647 lookup is
 * wasted effort on a two-language store.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split("=")[1]) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    if (tag.startsWith("ar")) return "ar";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}
