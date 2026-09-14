import { cache } from "react";
import { collection, getDocs, limit as fsLimit, orderBy, query } from "firebase/firestore";

import { getDb } from "@/lib/firebase/client";
import { orderConverter } from "@/lib/firebase/converters";
import {
  demoCustomers,
  demoInvoices,
  demoOrders,
  demoTickets,
  type CustomerSummary,
} from "@/data/demo-operations";
import type { Invoice, Order, SupportTicket } from "@/types";

/**
 * Admin data access.
 *
 * Mirrors `src/lib/catalog.ts`: read Firestore, fall back to generated
 * operations data on an empty result, an error, or a timeout. The admin is the
 * screen most often opened before any real data exists, so an empty database
 * has to produce a usable dashboard rather than a wall of zeros and a spinner.
 *
 * Everything is wrapped in React's `cache()`, so a dashboard that asks for the
 * order list in six different widgets issues one read.
 */

const READ_TIMEOUT_MS = 5000;
const ALLOW_DEMO = process.env.NEXT_PUBLIC_DISABLE_DEMO_FALLBACK !== "true";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`admin read timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function readOrFallback<T>(
  label: string,
  read: () => Promise<T[]>,
  fallback: () => T[],
): Promise<{ rows: T[]; live: boolean }> {
  try {
    const rows = await withTimeout(read(), READ_TIMEOUT_MS);
    if (rows.length > 0) return { rows, live: true };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[THE JO admin] read "${label}" failed — serving generated operations data.`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { rows: ALLOW_DEMO ? fallback() : [], live: false };
}

/* -------------------------------------------------------------------------- */

export const getAdminOrders = cache(async (): Promise<{ rows: Order[]; live: boolean }> =>
  readOrFallback(
    "orders",
    async () => {
      const snap = await getDocs(
        query(
          collection(getDb(), "orders").withConverter(orderConverter),
          orderBy("createdAt", "desc"),
          fsLimit(1000),
        ),
      );
      return snap.docs.map((d) => d.data());
    },
    () => demoOrders,
  ),
);

export const getAdminOrderByReference = cache(async (reference: string) => {
  const { rows } = await getAdminOrders();
  return rows.find((order) => order.reference === reference) ?? null;
});

/* -------------------------------------------------------------------------- */

export const getAdminInvoices = cache(async (): Promise<{ rows: Invoice[]; live: boolean }> =>
  readOrFallback(
    "invoices",
    async () => {
      const snap = await getDocs(
        query(collection(getDb(), "invoices"), orderBy("issuedAt", "desc"), fsLimit(1000)),
      );
      return snap.docs.map((d) => ({ ...(d.data() as Omit<Invoice, "id">), id: d.id }));
    },
    () => demoInvoices,
  ),
);

export const getAdminInvoiceByNumber = cache(async (number: string) => {
  const { rows } = await getAdminInvoices();
  return rows.find((invoice) => invoice.number === number) ?? null;
});

/* -------------------------------------------------------------------------- */

export const getAdminTickets = cache(async (): Promise<{ rows: SupportTicket[]; live: boolean }> =>
  readOrFallback(
    "supportTickets",
    async () => {
      const snap = await getDocs(
        query(collection(getDb(), "supportTickets"), orderBy("updatedAt", "desc"), fsLimit(500)),
      );
      return snap.docs.map((d) => ({ ...(d.data() as Omit<SupportTicket, "id">), id: d.id }));
    },
    () => demoTickets,
  ),
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
  if (!live) return demoCustomers;

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
