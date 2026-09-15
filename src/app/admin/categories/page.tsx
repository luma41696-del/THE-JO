import { CategoriesBoard } from "@/components/admin/CategoriesBoard";
import { getAdminCategories } from "@/lib/admin/data";

export const metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  const categories = await getAdminCategories();
  return <CategoriesBoard categories={categories} />;
}
