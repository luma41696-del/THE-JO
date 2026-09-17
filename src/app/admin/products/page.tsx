import { ProductsBoard } from "@/components/admin/ProductsBoard";
import { getAdminProducts, getAdminCategories } from "@/lib/admin/data";
import { getAdminSession } from "@/lib/firebase/session";

export const metadata = { title: "Products" };

export default async function AdminProductsPage() {
  const [products, categories, session] = await Promise.all([
    getAdminProducts(),
    getAdminCategories(),
    getAdminSession(),
  ]);

  /*
   * Hiding the control is a courtesy; the route refuses a non-administrator
   * regardless. A button that is merely absent is not a permission.
   */
  return (
    <ProductsBoard
      products={products}
      categories={categories}
      canDelete={session?.role === "admin"}
    />
  );
}
