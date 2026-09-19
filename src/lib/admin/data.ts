import "server-only";

import { cache } from "react";
import { Timestamp } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { requireAdminSession } from "@/lib/firebase/session";
import {
  demoProducts,
  demoCategories,
  demoOffers,
  demoBanners,
  demoShippingClasses,
} from "@/data/demo";
import { buildCategoryTree } from "@/lib/categories";
import {
  demoCustomers,
  demoInvoices,
  demoOrders,
  demoTickets,
  type CustomerSummary,
} from "@/data/demo-operations";
import type { ErrorReport } from "@/lib/monitoring/fingerprint";
import type {
  AnalyticsEvent,
  Banner,
  Category,
  CategoryNode,
  GiftCampaign,
  GiftPlay,
  Invoice,
  Notification,
  Offer,
  Order,
  Product,
  Review,
  ShippingClass,
  SupportTicket,
} from "@/types";

/**
 * Admin data access.
 *
 * Every read checks the verified server session before using Admin SDK.
 * A client component is never the boundary for private server-rendered data.
 * React cache deduplicates reads within one request, never across accounts.
 */

const READ_TIMEOUT_MS = 5000;
const ALLOW_DEMO = process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_DISABLE_DEMO_FALLBACK !== "true";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`admin read timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Admin timestamps must become plain values before reaching Client Components. */
function serialise<T>(input: unknown): T {
  if (input instanceof Timestamp) return input.toMillis() as T;
  if (input instanceof Date) return input.getTime() as T;
  if (Array.isArray(input)) return input.map((value) => serialise(value)) as T;
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, serialise(value)])) as T;
  }
  return input as T;
}

/**
 * Read a whole time window, paging past the per-query cap.
 *
 * The count-capped read below is fine for a table that shows the most recent
 * N rows. It is **wrong for a report**: "revenue over 90 days" computed from
 * the most recent 1000 orders is silently short the moment the shop passes
 * 1000 orders in that window, and the number it produces looks entirely
 * plausible — which is what makes it dangerous. Nobody notices a total that is
 * merely too low.
 *
 * So a report reads by date and pages until the window is exhausted, with a
 * hard page ceiling so a runaway query cannot hang the admin. When that
 * ceiling is hit the result says `truncated: true`, and the UI says so out
 * loud rather than presenting a partial total as a fact.
 */
async function readWindow<T>(
  name: string,
  timeField: string,
  from: number,
  fallback: () => T[],
  pageSize = 500,
  maxPages = 40,
): Promise<{ rows: T[]; live: boolean; truncated: boolean }> {
  const session = await requireAdminSession();
  if (!session) return { rows: ALLOW_DEMO ? fallback() : [], live: false, truncated: false };

  try {
    const db = getAdminDb();
    const rows: T[] = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let pages = 0;

    for (; pages < maxPages; pages += 1) {
      let q = db
        .collection(name)
        .where(timeField, ">=", from)
        .orderBy(timeField, "asc")
        .limit(pageSize);
      if (cursor) q = q.startAfter(cursor);

      const snapshot: FirebaseFirestore.QuerySnapshot = await withTimeout(q.get(), READ_TIMEOUT_MS);
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        rows.push(serialise<T>({ ...doc.data(), id: doc.id }));
      }

      if (snapshot.size < pageSize) break;
      cursor = snapshot.docs[snapshot.docs.length - 1] ?? null;
    }

    return { rows, live: true, truncated: pages >= maxPages };
  } catch {
    return { rows: ALLOW_DEMO ? fallback() : [], live: false, truncated: false };
  }
}

async function readCollection<T>(
  name: string,
  orderField: string,
  maxRows: number,
  fallback: () => T[],
): Promise<{ rows: T[]; live: boolean }> {
  // Keep authorization outside the catch so redirects cannot become demo data.
  const session = await requireAdminSession();
  if (!session) return { rows: ALLOW_DEMO ? fallback() : [], live: false };
  try {
    const snapshot = await withTimeout(
      getAdminDb().collection(name).orderBy(orderField, "desc").limit(maxRows).get(),
      READ_TIMEOUT_MS,
    );
    const rows = snapshot.docs.map((doc) => serialise<T>({ ...doc.data(), id: doc.id }));
    return { rows, live: true };
  } catch (error) {
    if (!ALLOW_DEMO) throw error;
    console.warn(`[net sale admin] read "${name}" failed — serving generated data.`);
  }
  return { rows: ALLOW_DEMO ? fallback() : [], live: false };
}

/* -------------------------------------------------------------------------- */

export const getAdminOrders = cache(async (): Promise<{ rows: Order[]; live: boolean }> =>
  readCollection("orders", "createdAt", 1000, () => demoOrders),
);

export const getAdminOrderByReference = cache(async (reference: string) => {
  const { rows } = await getAdminOrders();
  return rows.find((order) => order.reference === reference) ?? null;
});

/* -------------------------------------------------------------------------- */

/**
 * The delivery log for one order.
 *
 * No demo fallback, deliberately. An empty list means "nothing was sent",
 * which is the truth for every order in the generated history — inventing
 * plausible delivery records would put fabricated evidence of contact against
 * a customer nobody ever emailed.
 */
export const getOrderNotifications = cache(async (orderId: string): Promise<Notification[]> => {
  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const snap = await getAdminDb()
      .collection("notifications")
      .where("orderId", "==", orderId)
      .get();
    return snap.docs
      .map((d) => serialise<Notification>({ ...d.data(), id: d.id }))
      .sort((a, b) => b.queuedAt - a.queuedAt);
  } catch {
    return [];
  }
});

/* -------------------------------------------------------------------------- */

/**
 * Crash reports, worst first.
 *
 * No demo fallback: an empty list must mean "nothing has crashed", never
 * "here are some plausible-looking failures". Inventing errors would send
 * somebody hunting a bug that does not exist.
 */
export const getErrorReports = cache(async (): Promise<ErrorReport[]> => {
  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const snap = await getAdminDb()
      .collection("errorReports")
      .orderBy("count", "desc")
      .limit(50)
      .get();
    return snap.docs.map((d) => serialise<ErrorReport>(d.data()));
  } catch {
    return [];
  }
});

/* -------------------------------------------------------------------------- */

export const getAdminInvoices = cache(async (): Promise<{ rows: Invoice[]; live: boolean }> =>
  readCollection("invoices", "issuedAt", 1000, () => demoInvoices),
);

export const getAdminInvoiceByNumber = cache(async (number: string) => {
  const { rows } = await getAdminInvoices();
  return rows.find((invoice) => invoice.number === number) ?? null;
});

/* -------------------------------------------------------------------------- */

/*
 * `tickets`, not `supportTickets`. This screen read one collection while every
 * write — the staff reply route, the security rules, and now the customer's own
 * messages — used the other, so the inbox could never have shown a real ticket,
 * and a staff reply would have failed against a document that was not there.
 */
export const getAdminTickets = cache(async (): Promise<{ rows: SupportTicket[]; live: boolean }> =>
  readCollection("tickets", "updatedAt", 500, () => demoTickets),
);

export const getAdminTicketByReference = cache(async (reference: string) => {
  const { rows } = await getAdminTickets();
  return rows.find((ticket) => ticket.reference === reference) ?? null;
});

/* -------------------------------------------------------------------------- */

/**
 * Customers, derived from the order list rather than read separately.
 *
 * Lifetime value, order count and recency are all properties of the order
 * history; deriving them means the customer screen can never disagree with the
 * orders screen, which is a class of bug that is otherwise very hard to notice.
 */
export const getAdminCustomers = cache(async (): Promise<CustomerSummary[]> => {
  const { rows, live } = await getAdminOrders();
  if (!live) return ALLOW_DEMO ? demoCustomers : [];

  const acc = new Map<string, CustomerSummary>();

  for (const order of rows) {
    if (order.status === "cancelled") continue;
    const revenue = order.status === "refunded" ? 0 : order.totals.total;
    const existing = acc.get(order.uid);

    if (existing) {
      existing.orders += 1;
      existing.revenue += revenue;
      existing.firstOrderAt = Math.min(existing.firstOrderAt, order.createdAt);
      existing.lastOrderAt = Math.max(existing.lastOrderAt, order.createdAt);
    } else {
      acc.set(order.uid, {
        uid: order.uid,
        name: order.shippingAddress.fullName,
        email: order.email,
        city: order.shippingAddress.city,
        orders: 1,
        revenue,
        firstOrderAt: order.createdAt,
        lastOrderAt: order.createdAt,
      });
    }
  }

  /*
   * Everyone with an account, not only everyone with an order.
   *
   * The summaries above are built from orders, which is the right basis for
   * revenue — but it means a registered customer who has not bought anything
   * is invisible. That is precisely the account somebody needs to block: the
   * one signing up to abuse reviews or burn the SMS budget, which has no
   * orders by definition.
   */
  /*
   * The addresses each account signed in from, read alongside the accounts.
   * One collection read for the whole board rather than one per row.
   */
  const addresses = new Map<string, CustomerSummary["signInIps"]>();
  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const snap = await getAdminDb().collection("users").limit(1000).get();
    for (const doc of snap.docs) {
      const seen = (doc.data().signInIps ?? []) as {
        ip?: string;
        last?: number;
        count?: number;
      }[];
      const rows = seen
        .filter((entry) => typeof entry.ip === "string" && entry.ip)
        .map((entry) => ({ ip: entry.ip!, last: entry.last ?? 0, count: entry.count ?? 0 }))
        .sort((a, b) => b.last - a.last);
      if (rows.length > 0) addresses.set(doc.id, rows);
    }
  } catch (error) {
    // The board is still worth showing without them; what is lost is the
    // option to block an address from the block dialog.
    console.warn("[net sale] Could not read sign-in addresses.", error);
  }

  try {
    const { getAdminAuth } = await import("@/lib/firebase/admin");
    const auth = getAdminAuth();

    // One page of a thousand. A shop that outgrows this needs paging in the
    // board too, so it fails visibly rather than silently listing a subset.
    const { users } = await auth.listUsers(1000);

    for (const user of users) {
      // Staff belong to the Access screen, which knows about roles.
      const role = user.customClaims?.role;
      if (role === "staff" || role === "admin") continue;

      const existing = acc.get(user.uid);
      const account = {
        disabled: user.disabled,
        signInIps: addresses.get(user.uid),
        createdAt: Date.parse(user.metadata.creationTime) || undefined,
        lastSignInAt: user.metadata.lastSignInTime
          ? Date.parse(user.metadata.lastSignInTime) || undefined
          : undefined,
        providers: user.providerData.map((entry) => entry.providerId),
      };

      if (existing) Object.assign(existing, account);
      else
        acc.set(user.uid, {
          uid: user.uid,
          name: user.displayName ?? user.email ?? user.phoneNumber ?? user.uid,
          email: user.email ?? "",
          city: "",
          orders: 0,
          revenue: 0,
          firstOrderAt: 0,
          lastOrderAt: 0,
          neverOrdered: true,
          ...account,
        });
    }
  } catch (error) {
    // The order-derived list is still worth showing; what is lost is the
    // blocked flag and the accounts that have never ordered.
    console.warn("[net sale] Could not list sign-in accounts.", error);
  }

  return [...acc.values()].sort((a, b) => b.revenue - a.revenue);
});

export type { CustomerSummary };

// Admin views include drafts, archived products and expired campaigns.
export const getAdminProducts = cache(async (): Promise<Product[]> =>
  (await readCollection("products", "publishedAt", 1000, () => demoProducts)).rows,
);
/**
 * Categories in *tree* order — every department immediately followed by its
 * own subcategories — rather than flat by `order`, which interleaves the two
 * levels and makes the picker unreadable.
 */
export const getAdminCategories = cache(async (): Promise<Category[]> => {
  const { rows } = await readCollection("categories", "order", 1000, () => demoCategories);

  const byOrder = (a: Category, b: Category) => a.order - b.order || a.id.localeCompare(b.id);
  const flatten = (nodes: CategoryNode[]): Category[] =>
    nodes.flatMap((node) => {
      const { children, ...self } = node;
      return [self as Category, ...flatten(children)];
    });

  return flatten(buildCategoryTree([...rows].sort(byOrder)));
});

/**
 * Orders across a reporting window, complete rather than capped.
 *
 * Used by anything that computes a total. The dashboard's tables still use
 * `getAdminOrders`, which is count-capped and right for "the latest 1000".
 */
export const getAdminOrdersSince = cache(
  async (from: number): Promise<{ rows: Order[]; live: boolean; truncated: boolean }> =>
    readWindow<Order>("orders", "createdAt", from, () => demoOrders),
);

/** Analytics events across a window, for the behaviour report. */
export const getAnalyticsEvents = cache(
  async (from: number): Promise<{ rows: AnalyticsEvent[]; live: boolean; truncated: boolean }> =>
    readWindow<AnalyticsEvent>("analyticsEvents", "at", from, () => []),
);

/** Every review, including held ones — the moderation queue needs both. */
export const getAdminReviews = cache(async (): Promise<Review[]> =>
  (await readCollection<Review>("reviews", "createdAt", 1000, () => [])).rows,
);

/** Gift campaigns, newest first. */
export const getAdminGiftCampaigns = cache(async (): Promise<GiftCampaign[]> =>
  (await readCollection<GiftCampaign>("giftCampaigns", "startsAt", 100, () => [])).rows,
);

/** Plays, for the campaign report. */
export const getAdminGiftPlays = cache(async (): Promise<GiftPlay[]> =>
  (await readCollection<GiftPlay>("giftPlays", "playedAt", 1000, () => [])).rows,
);

export const getAdminShippingClasses = cache(async (): Promise<ShippingClass[]> =>
  (await readCollection("shippingClasses", "order", 100, () => demoShippingClasses)).rows.sort(
    (a, b) => a.order - b.order,
  ),
);
export const getAdminOffers = cache(async (): Promise<Offer[]> =>
  (await readCollection("offers", "startsAt", 1000, () => demoOffers)).rows,
);
export const getAdminBanners = cache(async (): Promise<Banner[]> =>
  (await readCollection("banners", "priority", 1000, () => demoBanners)).rows,
);

/**
 * "Now" for the admin.
 *
 * With generated data the newest order is the effective present, so the charts
 * are not mostly empty space to the right of the last bar. Against live data it
 * is the wall clock.
 */
export function adminNow(orders: Order[], live: boolean) {
  if (live) return Date.now();
  return orders.reduce((latest, o) => Math.max(latest, o.createdAt), 0) + 3_600_000;
}
