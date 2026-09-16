import { t as tr } from "@/lib/format";
import type { Order } from "@/types";

/**
 * Which orders "these orders" means.
 *
 * Extracted because two screens now have to agree on it: the board the
 * operator is looking at, and the batch print they reach from it. If the print
 * route re-implemented the filter, the day somebody changed one of them would
 * be the day the warehouse printed a different set from the one on screen —
 * and nobody would notice until a parcel went missing.
 */

/** Statuses that still need somebody to do something. */
export const NEEDS_ACTION = ["pending", "paid", "processing"] as const;

export interface OrderFilter {
  /** A status, `needs-action`, or `all`. Anything unknown means `all`. */
  status?: string;
  /** Free text over reference, customer, city, tracking and item names. */
  search?: string;
}

export function filterOrders(orders: Order[], { status, search }: OrderFilter = {}): Order[] {
  let list = orders;

  if (status === "needs-action") {
    list = list.filter((order) => NEEDS_ACTION.includes(order.status as never));
  } else if (status && status !== "all") {
    list = list.filter((order) => order.status === status);
  }

  const needle = search?.trim().toLowerCase();
  if (needle) {
    list = list.filter((order) =>
      [
        order.reference,
        order.email,
        order.shippingAddress?.fullName ?? "",
        order.shippingAddress?.city ?? "",
        order.trackingNumber ?? "",
        // English titles only, matching the board: the operator types what the
        // admin shows them, and the admin lists products in English.
        ...order.items.map((item) => tr(item.title, "en")),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }

  return list;
}

/**
 * How many receipts one batch will print.
 *
 * A cap exists because "print all" on a shop with four thousand orders is one
 * click away from a print queue nobody can stop. The batch prints the newest
 * ones and says plainly how many it left out, rather than silently trimming.
 */
export const MAX_BATCH = 200;

export function batchFor(orders: Order[]): { printing: Order[]; omitted: number } {
  const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);
  return {
    printing: sorted.slice(0, MAX_BATCH),
    omitted: Math.max(0, sorted.length - MAX_BATCH),
  };
}
