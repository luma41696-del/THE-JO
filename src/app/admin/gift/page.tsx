import { GiftBoard } from "@/components/admin/GiftBoard";
import { getAdminGiftCampaigns, getAdminGiftPlays } from "@/lib/admin/data";

export const metadata = { title: "Gift game" };

export default async function AdminGiftPage() {
  const [campaigns, plays] = await Promise.all([
    getAdminGiftCampaigns(),
    getAdminGiftPlays(),
  ]);
  return <GiftBoard campaigns={campaigns} plays={plays} />;
}
