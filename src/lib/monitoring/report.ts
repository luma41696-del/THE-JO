import type { Locale } from "@/types";

/**
 * Send one crash report.
 *
 * Deliberately tiny and dependency-free: this is called from an error
 * boundary, which is running because something else already failed. Anything
 * it imports is something else that could be broken.
 *
 * Never throws, never awaits anything the caller depends on, and never shows
 * the customer a second failure on top of the first.
 */
export function reportError(
  error: Error & { digest?: string },
  boundary: "route" | "global",
  locale: Locale = "en",
): void {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({
    digest: error.digest,
    message: error.message,
    // `pathname` only — never `href`. A query string can hold a search term,
    // a mistyped email, a coupon. None of that belongs in an error log.
    path: window.location.pathname,
    locale,
    boundary,
  });

  try {
    /*
     * `sendBeacon` first: it survives the page being closed or navigated
     * away from, which is exactly what a person does when a page breaks.
     * A normal fetch is cancelled on unload and the report is lost — losing
     * precisely the crashes that annoyed someone enough to leave.
     */
    if (navigator.sendBeacon?.(`/api/errors`, new Blob([payload], { type: "application/json" }))) {
      return;
    }
  } catch {
    // Fall through to fetch.
  }

  try {
    void fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting is best-effort by definition. There is nothing above this.
  }
}
