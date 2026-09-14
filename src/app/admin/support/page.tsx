import { SupportBoard } from "@/components/admin/SupportBoard";
import { getAdminTickets } from "@/lib/admin/data";

export const metadata = { title: "Support" };

export default async function AdminSupportPage() {
  const { rows } = await getAdminTickets();
  return <SupportBoard tickets={rows} />;
}
