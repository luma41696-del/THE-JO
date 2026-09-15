import { notFound } from "next/navigation";

import { OrderDetail } from "@/components/admin/OrderDetail";
import { NotificationLog } from "@/components/admin/NotificationLog";
import { getAdminOrderByReference, getOrderNotifications } from "@/lib/admin/data";
import { notifyStatus } from "@/lib/notify/provider";

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

  const notifications = await getOrderNotifications(order.id);

  return (
    <>
      <OrderDetail order={order} />
      <div className="mt-4">
        <NotificationLog
          notifications={notifications}
          providerConfigured={notifyStatus().configured}
        />
      </div>
    </>
  );
}
