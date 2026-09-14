import type { CurrencyCode, Locale, Localized } from "@/types";

const LOCALE_TAG: Record<Locale, string> = {
  en: "en-JO",
  ar: "ar-JO",
};

/**
 * Minor units per currency.
 *
 * The Jordanian dinar is divided into 1000 fils, so it carries **three**
 * decimal places — `12.500 JOD`, not `12.50`. Getting this wrong is not
 * cosmetic: a price stored as 12.5 and rendered as "12.50" is a different
 * number from the one the payment gateway will charge, and rounding a 3dp
 * currency to 2dp loses money on every line.
 */
const MINOR_UNITS: Record<CurrencyCode, number> = {
  JOD: 3,
  SAR: 2,
  AED: 2,
  USD: 2,
  EUR: 2,
};

export function minorUnits(currency: CurrencyCode) {
  return MINOR_UNITS[currency] ?? 2;
}

/**
 * `Intl` formatters are expensive to construct and get hit once per price on a
 * grid of sixty products, so they are memoised per locale/currency pair.
 */
const currencyCache = new Map<string, Intl.NumberFormat>();

/**
 * Format a price.
 *
 * Trailing zeros are kept. A three-decimal currency displayed as "349" in one
 * place and "349.000" in another reads as two different prices, and on a
 * storefront that inconsistency is read as carelessness about money.
 *
 * Arabic uses Latin digits deliberately: prices are checked against card
 * statements, invoices and bank apps that use them, and Eastern Arabic numerals
 * force the shopper to translate between the two.
 */
export function formatPrice(
  amount: number,
  currency: CurrencyCode = "JOD",
  locale: Locale = "en",
) {
  const key = `${locale}:${currency}`;
  let formatter = currencyCache.get(key);

  if (!formatter) {
    const digits = minorUnits(currency);
    formatter = new Intl.NumberFormat(LOCALE_TAG[locale], {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      numberingSystem: "latn",
    });
    currencyCache.set(key, formatter);
  }

  return formatter.format(amount);
}

/**
 * Price without the currency symbol — for tables and summaries that name the
 * currency once in a header rather than on every row.
 */
export function formatAmount(
  amount: number,
  currency: CurrencyCode = "JOD",
  locale: Locale = "en",
) {
  const digits = minorUnits(currency);
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    numberingSystem: "latn",
  }).format(amount);
}

export function formatNumber(value: number, locale: Locale = "en") {
  return new Intl.NumberFormat(LOCALE_TAG[locale], { numberingSystem: "latn" }).format(value);
}

export function formatDate(ms: number, locale: Locale = "en") {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    // Gregorian explicitly: ar-JO would otherwise be ambiguous for delivery
    // dates that must match what the courier's tracking page shows.
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(ms));
}

export function formatDateRange(fromMs: number, toMs: number, locale: Locale = "en") {
  const fmt = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    day: "numeric",
    month: "short",
    calendar: "gregory",
    numberingSystem: "latn",
  });
  return `${fmt.format(new Date(fromMs))} – ${fmt.format(new Date(toMs))}`;
}

/** Pick the active language out of a `Localized` value, falling back to EN. */
export function t(value: Localized | undefined, locale: Locale = "en"): string {
  if (!value) return "";
  return value[locale] || value.en || "";
}

/** Remaining time to a deadline, pre-split for a countdown component. */
export function countdownParts(endsAt: number, now = Date.now()) {
  const remaining = Math.max(0, endsAt - now);
  const totalSeconds = Math.floor(remaining / 1000);
  return {
    expired: remaining === 0,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

/** `2 – 4 business days`, or `Today` for same-day. */
export function formatDeliveryWindow(minDays: number, maxDays: number, locale: Locale = "en") {
  if (maxDays === 0) return locale === "ar" ? "اليوم" : "Today";
  if (minDays === maxDays) {
    return locale === "ar" ? `${minDays} أيام عمل` : `${minDays} business days`;
  }
  return locale === "ar"
    ? `${minDays} – ${maxDays} أيام عمل`
    : `${minDays} – ${maxDays} business days`;
}

export function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
