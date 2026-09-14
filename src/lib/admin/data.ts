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
import type {
  Banner,
  Category,
  CategoryNode,
  Invoice,
  Offer,
  Order,
  Product,
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

export const getAdminInvoices = cache(async (): Promise<{ rows: Invoice[]; live: boolean }> =>
  readCollection("invoices", "issuedAt", 1000, () => demoInvoices),
);

export const getAdminInvoiceByNumber = cache(async (number: string) => {
  const { rows } = await getAdminInvoices();
  return rows.find((invoice) => invoice.number === number) ?? null;
});

/* -------------------------------------------------------------------------- */

export const getAdminTickets = cache(async (): Promise<{ rows: SupportTicket[]; live: boolean }> =>
  readCollection("supportTickets", "updatedAt", 500, () => demoTickets),
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
