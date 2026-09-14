import { OffersBoard } from "@/components/admin/OffersBoard";
import { adminNow, getAdminOrders, getAdminOffers, getAdminBanners } from "@/lib/admin/data";

export const metadata = { title: "Offers & campaigns" };

export default async function AdminOffersPage() {
  const [offers, banners, { rows, live }] = await Promise.all([
    getAdminOffers(),
    getAdminBanners(),
    getAdminOrders(),
  ]);

  return (
    <OffersBoard
      offers={offers}
      banners={banners}
      now={adminNow(rows, live)}
    />
  );
}
