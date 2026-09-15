"use client";

import { analyticsAllowed } from "./consent";
import type { AnalyticsEventName } from "@/types";

/**
 * Event recording.
 *
 * Every call is a no-op unless analytics consent has been given, and the check
 * is *here* rather than at each call site — a single guard cannot be forgotten
 * by the next person to add an event.
 *
 * The property allow-list is the other half. Callers pass whatever is
 * convenient, and this module keeps only the keys it recognises: the one time
 * somebody passes a whole cart line or an address object is the time a
 * customer's street ends up in the analytics store, and no amount of care at
 * the call sites prevents that reliably.
 */

/**
 * Keys that may be recorded.
 *
 * Deliberately small, and deliberately free of anything identifying. Absent by
 * design: email, phone, name, address, postcode, card details, body
 * measurements, image URLs, and the full referrer — which frequently carries a
 * search query or a session token in its own parameters.
 */
const ALLOWED_PROPS = new Set([
  "productId",
  "productSlug",
  "categoryId",
  "sku",
  "price",
  "currency",
  "quantity",
  "value",
  "query",
  "results",
  "filter",
  "sort",
  "method",
  "code",
  "reason",
  "prizeId",
  "step",
  "position",
  "orderReference",
]);

/** A search term is a person's words; it is truncated and never stored raw-long. */
const MAX_STRING = 120;

export interface TrackOptions {
  /** Signed-in uid, attached only with consent. */
  uid?: string | null;
}

/**
 * A per-browser random id.
 *
 * Random, not derived. A hashed email is still an identifier — it is stable,
 * it is joinable, and anyone holding the same email can reproduce it — so
 * "anonymised" data built on one is re-identifiable by design. This is a
 * random value with no relationship to the person, discarded when they clear
 * their browser.
 */
function anonymousId(): string {
  const KEY = "net-sale:aid";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Private browsing with storage blocked: a per-page id is still useful for
    // funnel shape, and there is nothing to persist anyway.
    return "ephemeral";
  }
}

/** A session is a visit: same tab, reset after 30 minutes of quiet. */
function sessionId(): string {
  const KEY = "net-sale:sid";
  const STAMP = "net-sale:sid:at";
  const THIRTY_MIN = 30 * 60 * 1000;
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(STAMP) ?? 0);
    let id = sessionStorage.getItem(KEY);
    if (!id || now - last > THIRTY_MIN) {
      id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(KEY, id);
    }
    sessionStorage.setItem(STAMP, String(now));
    return id;
  } catch {
    return "ephemeral";
  }
}

function device(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

/**
 * Where the visit came from.
 *
 * `utm_source` when present, otherwise the referring *host* only. The full
 * referrer URL is not recorded: it routinely carries the search terms someone
 * used to find the shop, and occasionally a session token belonging to another
 * site.
 */
function source(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const utm = new URLSearchParams(window.location.search).get("utm_source");
    if (utm) return utm.slice(0, 60);
    if (!document.referrer) return undefined;
    const host = new URL(document.referrer).hostname;
    return host === window.location.hostname ? undefined : host.slice(0, 60);
  } catch {
    return undefined;
  }
}

/**
 * Is this an internal visit?
 *
 * Admin sessions and local development are excluded so a merchant checking
 * their own shop does not appear in their own funnel — the numbers are small
 * enough that a day of testing would visibly distort them.
 */
function isInternal(): boolean {
  if (typeof window === "undefined") return true;
  if (window.location.pathname.startsWith("/admin")) return true;
  if (window.location.hostname === "localhost") return true;
  try {
    return localStorage.getItem("net-sale:staff") === "1";
  } catch {
    return false;
  }
}

function clean(props?: Record<string, unknown>): Record<string, string | number | boolean> {
  if (!props) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    // Objects and arrays are dropped entirely rather than serialised: that is
    // exactly how an address would get in.
  }
  return out;
}

/** Purchases already recorded this session, so a refresh cannot double-count. */
const recordedPurchases = new Set<string>();

export function track(
  name: AnalyticsEventName,
  props?: Record<string, unknown>,
  options: TrackOptions = {},
) {
  if (typeof window === "undefined") return;
  if (!analyticsAllowed()) return;
  if (isInternal()) return;

  /*
   * A purchase is the one event that must never be counted twice: the
   * confirmation page is refreshed, shared and returned to, and each of those
   * would otherwise add a sale that did not happen. Keyed on the order
   * reference, which is unique per order.
   */
  if (name === "purchase") {
    const reference = typeof props?.orderReference === "string" ? props.orderReference : null;
    if (!reference) return;
    if (recordedPurchases.has(reference)) return;
    try {
      const seen = JSON.parse(sessionStorage.getItem("net-sale:purchases") ?? "[]") as string[];
      if (seen.includes(reference)) return;
      sessionStorage.setItem("net-sale:purchases", JSON.stringify([...seen, reference].slice(-20)));
    } catch {
      // Storage unavailable; the in-memory set still covers the common case.
    }
    recordedPurchases.add(reference);
  }

  const payload = {
    name,
    anonymousId: anonymousId(),
    ...(options.uid ? { uid: options.uid } : {}),
    sessionId: sessionId(),
    at: Date.now(),
    path: window.location.pathname,
    device: device(),
    ...(source() ? { source: source() } : {}),
    props: clean(props),
  };

  /*
   * `sendBeacon` where available: it survives the page being closed, which is
   * precisely when the most interesting events happen — the last thing someone
   * did before abandoning a cart.
   */
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
    }
  } catch {
    // Analytics must never break the shop. A dropped event is a dropped event.
  }
}
