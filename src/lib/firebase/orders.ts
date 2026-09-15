"use client";

import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { getDb } from "./db";
import { orderConverter } from "./converters";
import type { Order, OrderStatus } from "@/types";

/**
 * Order reads for the signed-in customer.
 *
 * Writes deliberately live server-side only (see `/api/checkout`). Security
 * Rules allow a customer to *read* `orders` where `uid == request.auth.uid` and
 * allow no client writes at all, so a customer can never mark their own order
 * as paid or shipped.
 */

export async function fetchOrders(uid: string, max = 25): Promise<Order[]> {
  const snapshot = await getDocs(
    query(
      collection(getDb(), "orders").withConverter(orderConverter),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      fsLimit(max),
    ),
  );
  return snapshot.docs.map((doc) => doc.data());
}

export async function fetchOrderByReference(
  uid: string,
  reference: string,
): Promise<Order | null> {
  const snapshot = await getDocs(
    query(
      collection(getDb(), "orders").withConverter(orderConverter),
      where("uid", "==", uid),
      where("reference", "==", reference),
      fsLimit(1),
    ),
  );
  return snapshot.docs[0]?.data() ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Presentation helpers                                                      */
/* -------------------------------------------------------------------------- */

/** The happy path, in order. Cancelled and refunded sit outside it. */
export const FULFILMENT_STEPS: OrderStatus[] = [
  "paid",
  "processing",
  "packed",
  "shipped",
  "out-for-delivery",
  "delivered",
];

export const STATUS_LABELS: Record<OrderStatus, { en: string; ar: string }> = {
  pending: { en: "Awaiting payment", ar: "بانتظار الدفع" },
  paid: { en: "Payment confirmed", ar: "تم تأكيد الدفع" },
  processing: { en: "Preparing your order", ar: "قيد التجهيز" },
  packed: { en: "Packed", ar: "تم التغليف" },
  shipped: { en: "Shipped", ar: "تم الشحن" },
  "out-for-delivery": { en: "Out for delivery", ar: "قيد التوصيل" },
  delivered: { en: "Delivered", ar: "تم التسليم" },
  cancelled: { en: "Cancelled", ar: "ملغي" },
  refunded: { en: "Refunded", ar: "مُسترد" },
};

/** Tone for the status chip. Terminal-bad states are the only red. */
export function statusTone(status: OrderStatus): "neutral" | "progress" | "done" | "bad" {
  if (status === "cancelled" || status === "refunded") return "bad";
  if (status === "delivered") return "done";
  if (status === "pending") return "neutral";
  return "progress";
}

/** 0-1 progress through fulfilment, for the tracking bar. */
export function fulfilmentProgress(status: OrderStatus) {
  const index = FULFILMENT_STEPS.indexOf(status);
  if (index === -1) return 0;
  return (index + 1) / FULFILMENT_STEPS.length;
}
