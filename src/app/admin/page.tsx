import { Dashboard } from "@/components/admin/Dashboard";
import {
  adminNow,
  getAdminCategories,
  getAdminOrders,
  getAdminTickets,
} from "@/lib/admin/data";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const [{ rows: orders, live }, { rows: tickets }, categories] = await Promise.all([
    getAdminOrders(),
    getAdminTickets(),
    getAdminCategories(),
  ]);

  const categoryNames = Object.fromEntries(categories.map((c) => [c.id, c.name.en]));

  return (
    <Dashboard
      orders={orders}
      tickets={tickets}
      now={adminNow(orders, live)}
      categoryNames={categoryNames}
    />
  );
}
