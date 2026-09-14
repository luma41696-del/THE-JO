import { OrdersBoard } from "@/components/admin/OrdersBoard";
import { getAdminOrders } from "@/lib/admin/data";

export const metadata = { title: "Orders" };

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ rows }, { status }] = await Promise.all([getAdminOrders(), searchParams]);
  return <OrdersBoard orders={rows} initialStatus={status} />;
}
