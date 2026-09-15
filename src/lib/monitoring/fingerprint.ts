import type { Locale } from "@/types";

/**
 * Turning a flood of crashes into a short list a person can read.
 *
 * A bad deploy does not produce one error, it produces one *per visitor*. A
 * report-per-occurrence collection would cost money, be unreadable by the
 * afternoon, and bury the second, rarer bug underneath the obvious one. So
 * reports are grouped: the same fault on the same route is one document with a
 * count, a first-seen and a last-seen.
 *
 * Pure, so the grouping rule — the part that decides whether two crashes are
 * "the same" — can be tested without a database.
 */

export interface ErrorInput {
  /** Next's error digest. Present on server errors, absent on client ones. */
  digest?: string;
  message?: string;
  /** `location.pathname`, never `href` — see `routeOf`. */
  path?: string;
  locale?: Locale;
  /** Which boundary caught it. */
  boundary?: "route" | "global";
  userAgent?: string;
}

export interface ErrorReport {
  fingerprint: string;
  digest?: string;
  message: string;
  route: string;
  locale: Locale;
  boundary: "route" | "global";
  browser: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

/**
 * The route *pattern*, not the URL.
 *
 * Two reasons, and the second is the important one:
 *
 *  1. Grouping. `/en/product/wool-coat` and `/en/product/silk-dress` failing
 *     the same way is one bug, and a fingerprint per slug would hide that.
 *  2. Privacy. A query string can contain anything a customer typed — a
 *     search term, an email from a mistyped form, a coupon. None of it belongs
 *     in an error log, and the safest way to guarantee that is never to take
 *     it in the first place.
 */
export function routeOf(path: string | undefined): string {
  if (!path) return "/";
  const clean = path.split("?")[0]!.split("#")[0]!;
  const parts = clean.split("/").filter(Boolean);

  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (i === 0 && (part === "en" || part === "ar")) {
      out.push(":locale");
      continue;
    }
    const previous = parts[i - 1];
    // The segment after a known collection is an identifier, whatever it says.
    if (previous && ["product", "orders", "help", "legal", "about", "categories"].includes(previous)) {
      out.push(":slug");
      continue;
    }
    out.push(part);
  }
  return `/${out.join("/")}`;
}

/**
 * Browser family only — never the full user-agent string.
 *
 * "Safari 17 on iOS" is what makes a bug reproducible. The full string is a
 * fingerprinting vector and tells an engineer nothing extra.
 */
export function browserOf(userAgent: string | undefined): string {
  if (!userAgent) return "unknown";
  const ua = userAgent;
  const os = /iPhone|iPad|iOS/i.test(ua)
    ? "iOS"
    : /Android/i.test(ua)
      ? "Android"
      : /Mac OS X/i.test(ua)
        ? "macOS"
        : /Windows/i.test(ua)
          ? "Windows"
          : "other";

  // Order matters: Edge and Chrome both claim "Chrome", Chrome claims "Safari".
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "other";

  return `${browser} on ${os}`;
}

/**
 * Strip anything that could carry a person's data out of a message.
 *
 * Client-side error messages are written by libraries, not by us, and they
 * happily interpolate whatever they were handed — a URL with a token, an
 * email, an id. This is a blunt instrument on purpose: an over-redacted
 * message is still diagnosable, an under-redacted one is a breach.
 */
export function redact(message: string | undefined): string {
  if (!message) return "Unknown error";
  return message
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\b\d{9,}\b/g, "[number]")
    // Long opaque strings are tokens, ids or keys far more often than words.
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .trim()
    .slice(0, 300);
}

/**
 * Two crashes are "the same" when they are the same fault on the same route.
 *
 * The digest leads when there is one: Next computes it from the error and it
 * is stable across deploys of the same bug, which the message is not. Client
 * errors have no digest, so the redacted message stands in.
 */
export function fingerprintOf(input: ErrorInput): string {
  const route = routeOf(input.path);
  const key = input.digest?.trim() || redact(input.message);
  // Not a hash: readable ids make the admin list and the Firestore console
  // legible, and there is no secrecy requirement here.
  return `${route}::${key}`.slice(0, 200).replace(/[/#?[\]]/g, "_");
}

/** Build the stored shape from a raw report. */
export function toReport(input: ErrorInput, at: number): Omit<ErrorReport, "count"> {
  return {
    fingerprint: fingerprintOf(input),
    ...(input.digest ? { digest: String(input.digest).slice(0, 64) } : {}),
    message: redact(input.message),
    route: routeOf(input.path),
    locale: input.locale === "ar" ? "ar" : "en",
    boundary: input.boundary === "global" ? "global" : "route",
    browser: browserOf(input.userAgent),
    firstSeenAt: at,
    lastSeenAt: at,
  };
}
