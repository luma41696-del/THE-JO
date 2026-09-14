import { Dashboard } from "@/components/admin/Dashboard";
import { adminNow, getAdminOrders, getAdminTickets } from "@/lib/admin/data";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const [{ rows: orders, live }, { rows: tickets }] = await Promise.all([
    getAdminOrders(),
    getAdminTickets(),
  ]);

  return <Dashboard orders={orders} tickets={tickets} now={adminNow(orders, live)} />;
}
