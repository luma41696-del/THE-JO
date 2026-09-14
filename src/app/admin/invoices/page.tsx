import { InvoicesBoard } from "@/components/admin/InvoicesBoard";
import { getAdminInvoices } from "@/lib/admin/data";

export const metadata = { title: "Invoices" };

export default async function AdminInvoicesPage() {
  const { rows } = await getAdminInvoices();
  return <InvoicesBoard invoices={rows} />;
}
