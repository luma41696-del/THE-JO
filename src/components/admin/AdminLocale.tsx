"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { adminText, type AdminKey } from "@/lib/i18n/admin";
import type { Locale } from "@/types";

/**
 * The operator's language, which is not the shopper's.
 *
 * Deliberately separate from `LocaleProvider`. The storefront's locale is part
 * of the URL because it is part of the page a customer shares; an operator's
 * language is a preference on their own machine, and putting `/ar/admin` in
 * the routing would have meant two URLs for every operational screen and a
 * middleware rule to keep them apart.
 *
 * Stored per browser rather than on the account: an operator switching desks
 * is rare, and a preference that needs a round-trip to read cannot be applied
 * before the first paint.
 */

const STORAGE_KEY = "net-sale:admin-locale";

interface Value {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: AdminKey) => string;
  rtl: boolean;
}

const AdminLocaleContext = createContext<Value | null>(null);

export function AdminLocaleProvider({ children }: { children: ReactNode }) {
  /*
   * Starts English on both server and client, then adopts the stored choice
   * after mount. Reading localStorage during render would make the server's
   * HTML and the client's first render disagree, and React would discard the
   * tree — the hydration mismatch that costs a flash of the whole page.
   */
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "ar" || stored === "en") setLocaleState(stored);
    } catch {
      // Private browsing, or storage blocked. English is a fine answer.
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session.
    }
  }, []);

  const value = useMemo<Value>(
    () => ({
      locale,
      setLocale,
      rtl: locale === "ar",
      t: (key: AdminKey) => adminText(key, locale),
    }),
    [locale, setLocale],
  );

  return <AdminLocaleContext.Provider value={value}>{children}</AdminLocaleContext.Provider>;
}

/**
 * Admin strings and direction.
 *
 * Returns English outside a provider rather than throwing: a board rendered in
 * a test or a storybook should not need the whole shell around it.
 */
export function useAdminLocale(): Value {
  return (
    useContext(AdminLocaleContext) ?? {
      locale: "en",
      setLocale: () => {},
      rtl: false,
      t: (key: AdminKey) => adminText(key, "en"),
    }
  );
}
