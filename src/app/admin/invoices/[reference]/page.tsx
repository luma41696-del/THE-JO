import { notFound } from "next/navigation";

import { InvoiceDocument } from "@/components/admin/InvoiceDocument";
import { getAdminInvoices } from "@/lib/admin/data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  return { title: `Invoice for ${reference}` };
}

export default async function AdminInvoicePage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const { rows } = await getAdminInvoices();

  // Addressed by order reference, which is what staff and customers both quote.
  const invoice = rows.find((i) => i.orderReference === reference);
  if (!invoice) notFound();

  return <InvoiceDocument invoice={invoice} />;
}
