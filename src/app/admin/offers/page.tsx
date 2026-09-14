import { OffersBoard } from "@/components/admin/OffersBoard";
import { getActiveOffers, getBanners } from "@/lib/catalog";
import { adminNow, getAdminOrders } from "@/lib/admin/data";
import { demoOffers } from "@/data/demo";

export const metadata = { title: "Offers & campaigns" };

export default async function AdminOffersPage() {
  const [offers, promo, hero, spotlight, { rows, live }] = await Promise.all([
    getActiveOffers(),
    getBanners("promo-rail"),
    getBanners("hero"),
    getBanners("spotlight"),
    getAdminOrders(),
  ]);

  // The admin shows expired offers too — `getActiveOffers` filters them out for
  // the storefront, which is right there and wrong here.
  const all = offers.length > 0 ? offers : demoOffers;

  return (
    <OffersBoard
      offers={all}
      banners={[...hero, ...promo, ...spotlight]}
      now={adminNow(rows, live)}
    />
  );
}
