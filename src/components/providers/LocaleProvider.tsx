"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { LOCALE_META, localePath, otherLocale } from "@/lib/i18n/config";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/types";

/**
 * Locale context.
 *
 * The locale is already in the URL, so this provider exists purely so that a
 * client component fifteen levels deep can read it without every component in
 * between accepting and forwarding a `locale` prop it does not use.
 *
 * The dictionary is looked up here rather than passed from the server: it is a
 * plain synchronous object, and serialising the whole thing through the RSC
 * payload on every navigation would cost far more than the lookup.
 */

interface LocaleContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  rtl: boolean;
  t: Dictionary;
  /** Prefix a path with the active locale: `href("/shop")` → `/ar/shop`. */
  href: (path: string) => string;
  /** The same page in the other language. */
  alternate: { locale: Locale; label: string; ariaLabel: string };
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo<LocaleContextValue>(() => {
    const meta = LOCALE_META[locale];
    const other = otherLocale(locale);
    const t = getDictionary(locale);

    return {
      locale,
      dir: meta.dir,
      rtl: meta.dir === "rtl",
      t,
      href: (path: string) => localePath(path, locale),
      alternate: {
        locale: other,
        label: t.nav.switchLanguage,
        ariaLabel: t.nav.switchLanguageLabel,
      },
    };
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useI18n must be used inside <LocaleProvider>.");
  }
  return context;
}

/** Shorthand for components that only need the dictionary. */
export function useT() {
  return useI18n().t;
}

/** Shorthand for components that only need the locale code. */
export function useLocale() {
  return useI18n().locale;
}
