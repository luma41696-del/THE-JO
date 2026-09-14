import { ProductsBoard } from "@/components/admin/ProductsBoard";
import { getAllProducts, getCategories } from "@/lib/catalog";

export const metadata = { title: "Products" };

export default async function AdminProductsPage() {
  const [products, categories] = await Promise.all([getAllProducts(), getCategories()]);
  return <ProductsBoard products={products} categories={categories} />;
}
