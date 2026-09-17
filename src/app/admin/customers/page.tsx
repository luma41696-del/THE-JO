import { CustomersBoard } from "@/components/admin/CustomersBoard";
import { adminNow, getAdminCustomers, getAdminOrders } from "@/lib/admin/data";
import { getAdminSession } from "@/lib/firebase/session";

export const metadata = { title: "Customers" };

/*
 * Never cached. This board now shows whether an account is blocked, and a
 * blocked account that still reads as active for an hour is the kind of stale
 * that gets somebody served.
 */
export const dynamic = "force-dynamic";

export default async function AdminCustomersPage() {
  const [customers, { rows, live }, session] = await Promise.all([
    getAdminCustomers(),
    getAdminOrders(),
    getAdminSession(),
  ]);

  /*
   * The button is hidden for staff, and the route refuses them regardless.
   * Hiding alone would be decoration — the check that matters is server-side.
   */
  return (
    <CustomersBoard
      customers={customers}
      now={adminNow(rows, live)}
      canDelete={session?.role === "admin"}
    />
  );
}
