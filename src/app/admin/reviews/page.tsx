import { ReviewsBoard } from "@/components/admin/ReviewsBoard";
import { getAdminProducts, getAdminReviews } from "@/lib/admin/data";

export const metadata = { title: "Reviews" };

export default async function AdminReviewsPage() {
  const [reviews, products] = await Promise.all([getAdminReviews(), getAdminProducts()]);
  return <ReviewsBoard reviews={reviews} products={products} />;
}
