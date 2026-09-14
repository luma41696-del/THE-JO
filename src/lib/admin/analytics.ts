import { money } from "@/lib/pricing";
import { demoProducts } from "@/data/demo";
import type {
  AdminKpi,
  CategoryPerformance,
  CurrencyCode,
  Order,
  OrderStatus,
  ProductPerformance,
  TimeseriesPoint,
} from "@/types";

/**
 * Sales analytics.
 *
 * Pure functions over an order list — no fetching, no caching, no dates read
 * from the clock inside the maths. Every entry point takes an explicit `now`,
 * which is what makes these testable and what stops a chart quietly changing
 * shape between a server render and a client hydration.
 *
 * One rule governs every figure here: **revenue means money we kept.**
 * Cancelled orders never count. Refunded orders count as an order (they
 * happened, and hiding them flatters the conversion story) but contribute zero
 * revenue. Getting this wrong is the most common way a commerce dashboard ends
 * up lying to the person running the business.
 */

const DAY = 86_400_000;

/** Statuses that represent money actually taken and kept. */
const REVENUE_STATUSES: OrderStatus[] = [
  "paid",
  "processing",
  "packed",
  "shipped",
  "out-for-delivery",
  "delivered",
];

export function isRevenue(order: Order) {
  return REVENUE_STATUSES.includes(order.status);
}

/** Counts toward volume even if the money came back. Excludes cancellations. */
export function isCountable(order: Order) {
  return order.status !== "cancelled";
}

export function revenueOf(order: Order) {
  return isRevenue(order) ? order.totals.total : 0;
}

export function unitsOf(order: Order) {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/* -------------------------------------------------------------------------- */
/*  Windows                                                                   */
/* -------------------------------------------------------------------------- */

export type RangeKey = "7d" | "30d" | "90d" | "12m";

export const RANGES: Record<RangeKey, { days: number; label: string; bucket: "day" | "week" }> = {
  "7d": { days: 7, label: "Last 7 days", bucket: "day" },
  "30d": { days: 30, label: "Last 30 days", bucket: "day" },
  "90d": { days: 90, label: "Last 90 days", bucket: "week" },
  "12m": { days: 365, label: "Last 12 months", bucket: "week" },
};

export function ordersInWindow(orders: Order[], from: number, to: number) {
  return orders.filter((o) => o.createdAt >= from && o.createdAt < to);
}

/* -------------------------------------------------------------------------- */
/*  KPIs                                                                      */
/* -------------------------------------------------------------------------- */

/** Fractional change, with the degenerate cases named rather than divided by. */
function change(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 1;
  return (current - previous) / previous;
}

/**
 * Headline figures for a window, each compared against the *immediately
 * preceding window of the same length* — the only comparison that controls for
 * seasonality without needing a year of history.
 */
export function computeKpis(
  orders: Order[],
  range: RangeKey,
  now: number,
  currency: CurrencyCode = "JOD",
): AdminKpi {
  const span = RANGES[range].days * DAY;
  const current = ordersInWindow(orders, now - span, now).filter(isCountable);
  const previous = ordersInWindow(orders, now - span * 2, now - span).filter(isCountable);

  const sum = (list: Order[]) => ({
    revenue: money(
      list.reduce((total, order) => total + revenueOf(order), 0),
      currency,
    ),
    orders: list.length,
    units: list.reduce((total, order) => total + unitsOf(order), 0),
  });

  const a = sum(current);
  const b = sum(previous);

  // AOV is revenue over *revenue-generating* orders, not all orders — dividing
  // kept money by a count that includes refunds understates every basket.
  const payingNow = current.filter(isRevenue).length;
  const payingBefore = previous.filter(isRevenue).length;
  const aovNow = payingNow ? money(a.revenue / payingNow, currency) : 0;
  const aovBefore = payingBefore ? money(b.revenue / payingBefore, currency) : 0;

  return {
    revenue: a.revenue,
    orders: a.orders,
    units: a.units,
    averageOrderValue: aovNow,
    revenueChange: change(a.revenue, b.revenue),
    ordersChange: change(a.orders, b.orders),
    aovChange: change(aovNow, aovBefore),
    currency,
  };
}

/* -------------------------------------------------------------------------- */
/*  Timeseries                                                                */
/* -------------------------------------------------------------------------- */

function startOfDay(ms: number) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfWeek(ms: number) {
  const day = startOfDay(ms);
  // Weeks start Sunday, which is how the Jordanian trading week reads.
  return day - new Date(day).getUTCDay() * DAY;
}

/**
 * Bucketed series for the revenue chart.
 *
 * Empty buckets are emitted as zeros rather than skipped. A line chart that
 * omits a quiet day silently compresses the x-axis and turns a dip into a
 * straight line — the single most misleading thing a sales chart can do.
 */
export function buildTimeseries(
  orders: Order[],
  range: RangeKey,
  now: number,
  currency: CurrencyCode = "JOD",
): TimeseriesPoint[] {
  const { days, bucket } = RANGES[range];
  const from = now - days * DAY;
  const step = bucket === "day" ? DAY : 7 * DAY;
  const align = bucket === "day" ? startOfDay : startOfWeek;

  const buckets = new Map<number, TimeseriesPoint>();
  for (let t = align(from); t <= align(now); t += step) {
    buckets.set(t, { t, revenue: 0, orders: 0, units: 0 });
  }

  for (const order of orders) {
    if (order.createdAt < from || order.createdAt > now) continue;
    if (!isCountable(order)) continue;

    const key = align(order.createdAt);
    const point = buckets.get(key);
    if (!point) continue;

    point.revenue += revenueOf(order);
    point.orders += 1;
    point.units += unitsOf(order);
  }

  return [...buckets.values()]
    .sort((a, b) => a.t - b.t)
    .map((p) => ({ ...p, revenue: money(p.revenue, currency) }));
}

/* -------------------------------------------------------------------------- */
/*  Breakdowns                                                                */
/* -------------------------------------------------------------------------- */

/** Best sellers by units, with revenue alongside — they rank differently. */
export function topProducts(
  orders: Order[],
  range: RangeKey,
  now: number,
  limit = 8,
  currency: CurrencyCode = "JOD",
): ProductPerformance[] {
  const from = now - RANGES[range].days * DAY;
  const acc = new Map<string, ProductPerformance>();

  for (const order of ordersInWindow(orders, from, now)) {
    if (!isRevenue(order)) continue;

    for (const item of order.items) {
      const existing = acc.get(item.productId);
      const revenue = item.unitPrice * item.quantity;

      if (existing) {
        existing.units += item.quantity;
        existing.revenue += revenue;
        existing.orders += 1;
      } else {
        acc.set(item.productId, {
          productId: item.productId,
          slug: item.slug,
          title: item.title,
          image: item.image,
          units: item.quantity,
          revenue,
          orders: 1,
        });
      }
    }
  }

  return [...acc.values()]
    .map((p) => ({ ...p, revenue: money(p.revenue, currency) }))
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
    .slice(0, limit);
}

/**
 * Revenue and units by category.
 *
 * Rolls up to the **department**, not the leaf subcategory. Two reasons, and
 * the second is the load-bearing one:
 *
 *  - "Outerwear" is the number a merchant makes decisions with. Splitting it
 *    into Coats and Blazers answers a question nobody asked at this altitude,
 *    and both halves look small next to categories that were never split.
 *  - A categorical palette holds eight hues. Charting leaves produced
 *    thirteen series, which means either cycling colours — so two categories
 *    share one hue and the chart lies — or generating new ones, which lands
 *    on pairs no colour-blind reader can separate. Departments keep the
 *    series count inside the palette by construction rather than by luck.
 *
 * `categoryPath[0]` is the root, so the rollup is a lookup, not a tree walk.
 */
export function categoryBreakdown(
  orders: Order[],
  range: RangeKey,
  now: number,
  currency: CurrencyCode = "JOD",
): CategoryPerformance[] {
  const from = now - RANGES[range].days * DAY;
  const categoryOf = new Map(
    demoProducts.map((p) => [p.id, p.categoryPath[0] ?? p.categoryId]),
  );
  const acc = new Map<string, CategoryPerformance>();

  for (const order of ordersInWindow(orders, from, now)) {
    if (!isRevenue(order)) continue;

    for (const item of order.items) {
      const categoryId = categoryOf.get(item.productId) ?? "other";
      const revenue = item.unitPrice * item.quantity;
      const existing = acc.get(categoryId);

      if (existing) {
        existing.units += item.quantity;
        existing.revenue += revenue;
      } else {
        acc.set(categoryId, { categoryId, units: item.quantity, revenue });
      }
    }
  }

  const rows = [...acc.values()]
    .map((c) => ({ ...c, revenue: money(c.revenue, currency) }))
    .sort((a, b) => b.revenue - a.revenue);

  /*
   * Hard ceiling at eight series. Departments already fit today, but a
   * catalogue grows and nobody re-checks a chart when they add a department —
   * so the eighth slot collapses the tail into "Other" rather than silently
   * reusing a hue. An explicit bucket is honest; a repeated colour is not.
   */
  const MAX_SERIES = 8;
  if (rows.length <= MAX_SERIES) return rows;

  const head = rows.slice(0, MAX_SERIES - 1);
  const tail = rows.slice(MAX_SERIES - 1);
  return [
    ...head,
    {
      categoryId: "other",
      units: tail.reduce((sum, c) => sum + c.units, 0),
      revenue: money(
        tail.reduce((sum, c) => sum + c.revenue, 0),
        currency,
      ),
    },
  ];
}

/** How many orders sit at each stage — the fulfilment queue, as a number. */
export function statusCounts(orders: Order[]): Record<OrderStatus, number> {
  const base: Record<OrderStatus, number> = {
    pending: 0,
    paid: 0,
    processing: 0,
    packed: 0,
    shipped: 0,
    "out-for-delivery": 0,
    delivered: 0,
    cancelled: 0,
    refunded: 0,
  };
  for (const order of orders) base[order.status] += 1;
  return base;
}

/** Orders that need a human today: paid or processing, oldest first. */
export function actionQueue(orders: Order[], limit = 8) {
  return orders
    .filter((o) => o.status === "paid" || o.status === "processing" || o.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/*  Formatting helpers for the dashboard                                      */
/* -------------------------------------------------------------------------- */

export function formatChange(value: number) {
  const pct = Math.round(value * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export function changeTone(value: number, invert = false): "up" | "down" | "flat" {
  if (Math.abs(value) < 0.005) return "flat";
  const positive = value > 0;
  return (invert ? !positive : positive) ? "up" : "down";
}
