import { notFound } from "next/navigation";

import { OrderReceipt } from "@/components/admin/OrderReceipt";
import { getAdminOrderByReference } from "@/lib/admin/data";
import { getStoreSettings } from "@/lib/settings";

/**
 * The counter receipt for one order.
 *
 * Its own route rather than a mode of the order page: printing is driven by
 * `@page`, which is a document-level rule, and a page that has to be A4 for
 * one button and 80mm for another cannot express both. A separate route also
 * means the operator can keep it open on the till while working the order
 * screen next to it.
 *
 * Available for every order, not only invoiced ones — a receipt is what the
 * customer is handed when they collect or when the courier arrives, which
 * happens well before an order is settled.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  return { title: `Receipt ${reference}` };
}

export default async function AdminOrderReceiptPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const [order, settings] = await Promise.all([
    getAdminOrderByReference(reference),
    getStoreSettings(),
  ]);
  if (!order) notFound();

  return <OrderReceipt order={order} settings={settings} />;
}
