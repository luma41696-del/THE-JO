import { CustomersBoard } from "@/components/admin/CustomersBoard";
import { adminNow, getAdminCustomers, getAdminOrders } from "@/lib/admin/data";

export const metadata = { title: "Customers" };

export default async function AdminCustomersPage() {
  const [customers, { rows, live }] = await Promise.all([getAdminCustomers(), getAdminOrders()]);
  return <CustomersBoard customers={customers} now={adminNow(rows, live)} />;
}
