import type { Locale, Localized } from "@/types";

/**
 * What a customer is told when something fails.
 *
 * Two problems this exists to fix, both found by going looking for them rather
 * than by anything being reported:
 *
 *  1. **Raw browser strings reached customers.** Every client fetch was
 *     written as `error instanceof Error ? error.message : "…"`, and a dropped
 *     connection throws a `TypeError` whose message is "Failed to fetch". So
 *     the failure mode most likely to happen — bad signal — produced the least
 *     helpful sentence, in English, regardless of the language the customer
 *     was reading.
 *
 *  2. **The fallbacks were English-only.** Even when the raw string was
 *     avoided, "Could not save your review." is what an Arabic shopper saw.
 *
 * The rule: a message the **server** wrote is shown verbatim, because those are
 * written for customers and carry real information — "Only 2 of that remain",
 * "That coupon has expired". Anything else is replaced with a sentence in the
 * customer's own language that says what to do next.
 */

/**
 * An error whose message came from our own API.
 *
 * Tagging is what lets the catch tell "the coupon expired" from "Failed to
 * fetch" — they are both `Error`, and only one is worth showing.
 */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Was this a connection failure rather than a refusal? */
export function isNetworkError(error: unknown): boolean {
  // `fetch` rejects with a TypeError when the request never completed —
  // offline, DNS failure, CORS, an aborted connection.
  return error instanceof TypeError;
}

const NETWORK: Localized = {
  en: "We could not reach the shop. Check your connection and try again.",
  ar: "تعذّر الاتصال بالمتجر. تحقّق من اتصالك وأعد المحاولة.",
};

/**
 * Turn anything thrown into a sentence worth showing.
 *
 * `fallback` is the caller's own bilingual message for "this did not work",
 * used when the failure was not something the server explained.
 */
export function errorMessage(error: unknown, locale: Locale, fallback: Localized): string {
  if (error instanceof ApiError && error.message.trim()) return error.message;
  if (isNetworkError(error)) return NETWORK[locale];
  return fallback[locale];
}

/**
 * Read a JSON response, raising the server's own message on failure.
 *
 * Centralised so no caller has to remember the `!response.ok || !data.ok`
 * pair — forgetting the second half is how a 200 carrying `{ok: false}` gets
 * treated as success, which is the "fake success" this shop is careful about.
 */
export async function readJson<T extends { ok?: boolean; error?: string }>(
  response: Response,
): Promise<T> {
  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    // A non-JSON body means something upstream failed — a proxy error page,
    // a gateway timeout. Not a message to show, so it becomes the fallback.
    throw new ApiError("");
  }

  if (!response.ok || data.ok === false) {
    throw new ApiError(data.error ?? "");
  }
  return data;
}
