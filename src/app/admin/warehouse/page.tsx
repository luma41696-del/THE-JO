import { WarehouseBoard } from "@/components/admin/WarehouseBoard";
import { adminNow, getAdminCategories, getAdminOrders, getAdminProducts } from "@/lib/admin/data";

export const metadata = { title: "Seasonal warehouse" };

export default async function AdminWarehousePage() {
  const [products, categories, { rows, live }] = await Promise.all([
    getAdminProducts(),
    getAdminCategories(),
    getAdminOrders(),
  ]);

  return (
    <WarehouseBoard products={products} categories={categories} now={adminNow(rows, live)} />
  );
}
