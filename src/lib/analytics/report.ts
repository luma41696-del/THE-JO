/**
 * Turning raw events into the four questions a merchant actually asks.
 *
 * Pure functions over an event array, so they can be tested without Firestore
 * and reused whatever the read strategy becomes. The reads themselves are
 * bounded — see `getAnalyticsEvents` — because a collection that grows with
 * every page view will outrun any query that does not say how much it wants.
 */

import type { AnalyticsEvent, FunnelStep } from "@/types";

export type Period = "7d" | "30d" | "90d";

export const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };

const DAY = 86_400_000;

export function inPeriod(events: AnalyticsEvent[], period: Period, now = Date.now()) {
  const from = now - PERIOD_DAYS[period] * DAY;
  return events.filter((e) => e.at >= from && e.at <= now);
}

/* -------------------------------------------------------------------------- */
/*  Funnel                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The conversion funnel, counted in **sessions** rather than events.
 *
 * Counting events would let one indecisive shopper who added six things to
 * their bag outweigh six shoppers who each added one, and the resulting
 * "conversion rate" would be a number about nobody. A session either reached a
 * step or it did not.
 */
export function funnel(events: AnalyticsEvent[]): FunnelStep[] {
  const sessions = (name: AnalyticsEvent["name"]) =>
    new Set(events.filter((e) => e.name === name).map((e) => e.sessionId)).size;

  const viewed = new Set(
    events.filter((e) => e.name === "page_view" || e.name === "product_view").map((e) => e.sessionId),
  ).size;

  const raw = [
    { name: "visit", label: { en: "Visited", ar: "زيارة" }, count: viewed },
    {
      name: "product_view",
      label: { en: "Viewed a product", ar: "شاهد منتجاً" },
      count: sessions("product_view"),
    },
    { name: "cart_add", label: { en: "Added to bag", ar: "أضاف للحقيبة" }, count: sessions("cart_add") },
    {
      name: "checkout_start",
      label: { en: "Started checkout", ar: "بدأ الدفع" },
      count: sessions("checkout_start"),
    },
    { name: "purchase", label: { en: "Ordered", ar: "أتمّ الطلب" }, count: sessions("purchase") },
  ];

  return raw.map((step, index) => {
    const previous = index === 0 ? step.count : (raw[index - 1]?.count ?? 0);
    return {
      ...step,
      // Guarded: a step with no predecessor traffic is 0, not Infinity or NaN,
      // both of which render as a broken percentage.
      conversion: index === 0 ? 1 : previous > 0 ? step.count / previous : 0,
    };
  });
}

/**
 * Where sessions stop.
 *
 * The last path of each session that did *not* purchase. A session that
 * converted has no exit point worth reporting — it left because it was
 * finished.
 */
export function exitPoints(events: AnalyticsEvent[], limit = 8) {
  const bySession = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const list = bySession.get(event.sessionId) ?? [];
    list.push(event);
    bySession.set(event.sessionId, list);
  }

  const counts = new Map<string, number>();
  for (const [, list] of bySession) {
    if (list.some((e) => e.name === "purchase")) continue;
    const last = [...list].sort((a, b) => a.at - b.at).at(-1);
    if (!last) continue;
    counts.set(last.path, (counts.get(last.path) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/*  Search                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Searches that found nothing.
 *
 * The most directly actionable report in the system: a list of what customers
 * asked for in their own words and did not get. Every line is either a product
 * worth stocking, a synonym worth indexing, or a spelling worth handling.
 */
export function zeroResultSearches(events: AnalyticsEvent[], limit = 20) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.name !== "search_no_results") continue;
    const query = String(event.props?.query ?? "").trim().toLowerCase();
    if (!query) continue;
    counts.set(query, (counts.get(query) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function topSearches(events: AnalyticsEvent[], limit = 12) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.name !== "search") continue;
    const query = String(event.props?.query ?? "").trim().toLowerCase();
    if (!query) continue;
    counts.set(query, (counts.get(query) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/*  Breakdowns                                                                */
/* -------------------------------------------------------------------------- */

export function byDevice(events: AnalyticsEvent[]) {
  const counts = { mobile: 0, tablet: 0, desktop: 0 };
  const seen = new Set<string>();
  for (const event of events) {
    // One count per session, not per event: a mobile visitor who browsed
    // thirty pages is one mobile visitor.
    const key = `${event.sessionId}:${event.device}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[event.device] += 1;
  }
  return counts;
}

export function bySource(events: AnalyticsEvent[], limit = 8) {
  const counts = new Map<string, Set<string>>();
  for (const event of events) {
    const source = event.source ?? "direct";
    const set = counts.get(source) ?? new Set<string>();
    set.add(event.sessionId);
    counts.set(source, set);
  }
  return [...counts.entries()]
    .map(([source, sessions]) => ({ source, sessions: sessions.size }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

/** Most-viewed products, by session rather than by refresh. */
export function topProducts(events: AnalyticsEvent[], limit = 10) {
  const counts = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.name !== "product_view") continue;
    const id = String(event.props?.productId ?? "");
    if (!id) continue;
    const set = counts.get(id) ?? new Set<string>();
    set.add(event.sessionId);
    counts.set(id, set);
  }
  return [...counts.entries()]
    .map(([productId, sessions]) => ({ productId, views: sessions.size }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

/** Coupon attempts, split by whether they worked and why they did not. */
export function couponOutcomes(events: AnalyticsEvent[]) {
  let applied = 0;
  const rejected = new Map<string, number>();
  for (const event of events) {
    if (event.name === "coupon_apply") applied += 1;
    if (event.name === "coupon_reject") {
      const reason = String(event.props?.reason ?? "unknown");
      rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
    }
  }
  return {
    applied,
    rejected: [...rejected.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** A daily series of sessions, for the trend line. */
export function dailySessions(events: AnalyticsEvent[], period: Period, now = Date.now()) {
  const days = PERIOD_DAYS[period];
  const buckets = new Map<string, Set<string>>();

  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.set(new Date(now - i * DAY).toISOString().slice(0, 10), new Set());
  }

  for (const event of events) {
    const key = new Date(event.at).toISOString().slice(0, 10);
    buckets.get(key)?.add(event.sessionId);
  }

  return [...buckets.entries()].map(([day, sessions]) => ({ day, sessions: sessions.size }));
}
