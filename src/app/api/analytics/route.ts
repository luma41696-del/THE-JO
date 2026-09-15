import { NextResponse } from "next/server";

import { isAdminConfigured } from "@/lib/firebase/admin";
import type { AnalyticsEvent, AnalyticsEventName } from "@/types";

/**
 * Event intake.
 *
 * The client already strips unknown properties, but this repeats the filter
 * rather than trusting it. The browser is not a trusted writer: anyone can
 * POST here, and the one thing that must never happen is an address or a
 * measurement being accepted into the analytics store because it arrived in a
 * field nobody thought to check.
 *
 * Events are written and never read back per-visitor. There is no endpoint
 * that returns one person's event stream, and none is planned — the admin
 * reads aggregates.
 */

const NAMES: AnalyticsEventName[] = [
  "page_view",
  "product_view",
  "category_view",
  "search",
  "search_no_results",
  "filter_apply",
  "wishlist_add",
  "wishlist_remove",
  "cart_add",
  "cart_remove",
  "checkout_start",
  "purchase",
  "coupon_apply",
  "coupon_reject",
  "gift_play",
  "fitting_room_open",
  "recommendation_click",
];

/** Mirrors the client allow-list. Duplicated on purpose: see the note above. */
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

const MAX_STRING = 120;

function clean(props: unknown): Record<string, string | number | boolean> {
  if (!props || typeof props !== "object") return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (!ALLOWED_PROPS.has(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export async function POST(request: Request) {
  let body: Partial<AnalyticsEvent>;
  try {
    body = (await request.json()) as Partial<AnalyticsEvent>;
  } catch {
    // A malformed beacon is not worth an error page; it is worth no record.
    return new NextResponse(null, { status: 204 });
  }

  const name = NAMES.includes(body.name as AnalyticsEventName)
    ? (body.name as AnalyticsEventName)
    : null;
  if (!name) return new NextResponse(null, { status: 204 });

  const anonymousId = String(body.anonymousId ?? "").slice(0, 64);
  if (!anonymousId) return new NextResponse(null, { status: 204 });

  if (!isAdminConfigured()) return new NextResponse(null, { status: 204 });

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const event = {
      name,
      anonymousId,
      // The uid is stored only if the client sent one, which it only does with
      // consent. It is never derived here from a session cookie — that would
      // re-identify a visitor who declined.
      ...(typeof body.uid === "string" && body.uid ? { uid: body.uid.slice(0, 128) } : {}),
      sessionId: String(body.sessionId ?? "").slice(0, 64),
      at: Number(body.at) || Date.now(),
      path: String(body.path ?? "/").slice(0, 200),
      device:
        body.device === "mobile" || body.device === "tablet" ? body.device : ("desktop" as const),
      ...(body.source ? { source: String(body.source).slice(0, 60) } : {}),
      props: clean(body.props),
      /*
       * A day key, so the admin can aggregate a date range with an equality
       * filter instead of scanning. Without it, "last 30 days" is a range
       * query over a collection that grows forever.
       */
      day: new Date(Number(body.at) || Date.now()).toISOString().slice(0, 10),
    };

    await db.collection("analyticsEvents").add(event);
    return new NextResponse(null, { status: 204 });
  } catch {
    // Analytics failing must never surface to a shopper, and must never fail
    // the action that produced the event.
    return new NextResponse(null, { status: 204 });
  }
}
