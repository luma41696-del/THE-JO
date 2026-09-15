import { ShippingBoard } from "@/components/admin/ShippingBoard";
import { getShippingMethods, getShippingZones } from "@/lib/catalog";
import { getStoreSettings } from "@/lib/settings";

export const metadata = { title: "Delivery" };

/** Live, so the form opens on the rates the checkout is currently quoting. */
export const dynamic = "force-dynamic";

export default async function AdminShippingPage() {
  const [methods, zones, settings] = await Promise.all([
    getShippingMethods(),
    getShippingZones(),
    getStoreSettings(),
  ]);

  return (
    <ShippingBoard
      methods={methods}
      zones={zones}
      storeThreshold={settings.freeShippingThreshold}
    />
  );
}
