import { notFound } from "next/navigation";

import { OrderDetail } from "@/components/admin/OrderDetail";
import { getAdminOrderByReference } from "@/lib/admin/data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  return { title: `Order ${reference}` };
}

export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const order = await getAdminOrderByReference(reference);
  if (!order) notFound();

  return <OrderDetail order={order} />;
}
