import { ProductsBoard } from "@/components/admin/ProductsBoard";
import { getAdminProducts, getAdminCategories } from "@/lib/admin/data";

export const metadata = { title: "Products" };

export default async function AdminProductsPage() {
  const [products, categories] = await Promise.all([getAdminProducts(), getAdminCategories()]);
  return <ProductsBoard products={products} categories={categories} />;
}
