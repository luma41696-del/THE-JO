import { OffersBoard } from "@/components/admin/OffersBoard";
import {
  adminNow,
  getAdminBanners,
  getAdminCategories,
  getAdminOffers,
  getAdminOrders,
  getAdminProducts,
} from "@/lib/admin/data";

export const metadata = { title: "Offers & campaigns" };

export default async function AdminOffersPage() {
  const [offers, banners, categories, products, { rows, live }] = await Promise.all([
    getAdminOffers(),
    getAdminBanners(),
    // The coupon editor scopes a discount to categories and products, so both
    // lists travel with the board rather than being fetched on first open —
    // a drawer that spinners on every click reads as broken.
    getAdminCategories(),
    getAdminProducts(),
    getAdminOrders(),
  ]);

  return (
    <OffersBoard
      offers={offers}
      banners={banners}
      categories={categories}
      products={products}
      now={adminNow(rows, live)}
    />
  );
}
