import { notFound } from "next/navigation";

import { ProductEditor } from "@/components/admin/ProductEditor";
import { getAdminProducts, getAdminCategories } from "@/lib/admin/data";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id === "new" ? "New product" : "Edit product" };
}

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [products, categories] = await Promise.all([getAdminProducts(), getAdminCategories()]);

  if (id === "new") return <ProductEditor product={null} categories={categories} />;

  const product = products.find((p) => p.id === id);
  if (!product) notFound();

  return <ProductEditor product={product} categories={categories} />;
}
