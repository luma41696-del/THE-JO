import { OrdersPrintSheet } from "@/components/admin/OrdersPrintSheet";
import { getAdminOrders } from "@/lib/admin/data";
import { batchFor, filterOrders } from "@/lib/admin/orders-filter";
import { getStoreSettings } from "@/lib/settings";

/**
 * A whole filtered board of orders, as one print job.
 *
 * The filter arrives in the query string and is re-applied **here**, against
 * Firestore, rather than being handed a list of references by the browser.
 * Two reasons: the URL stays short whether it is three orders or two hundred,
 * and the set that prints is the set the server says matches — a stale tab
 * cannot print yesterday's queue.
 */
export const metadata = { title: "Print orders" };

export default async function AdminOrdersPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const [{ rows }, settings] = await Promise.all([getAdminOrders(), getStoreSettings()]);

  const matching = filterOrders(rows, { status, search: q });
  const { printing, omitted } = batchFor(matching);

  const label = [status && status !== "all" ? status : "all orders", q ? `“${q}”` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <OrdersPrintSheet
      orders={printing}
      settings={settings}
      omitted={omitted}
      filterLabel={label}
    />
  );
}
