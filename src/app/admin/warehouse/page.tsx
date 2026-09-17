import { WarehouseBoard } from "@/components/admin/WarehouseBoard";
import { adminNow, getAdminCategories, getAdminOrders, getAdminProducts } from "@/lib/admin/data";
import { getAdminSession } from "@/lib/firebase/session";

export const metadata = { title: "Seasonal warehouse" };

export default async function AdminWarehousePage() {
  const [products, categories, { rows, live }, session] = await Promise.all([
    getAdminProducts(),
    getAdminCategories(),
    getAdminOrders(),
    getAdminSession(),
  ]);

  /*
   * Hiding the control is a courtesy; the route refuses a non-administrator
   * regardless. A button that is merely absent is not a permission.
   */
  return (
    <WarehouseBoard
      products={products}
      categories={categories}
      now={adminNow(rows, live)}
      canDelete={session?.role === "admin"}
    />
  );
}
