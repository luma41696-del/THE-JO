import { SettingsBoard } from "@/components/admin/SettingsBoard";
import { PointsSettings } from "@/components/admin/PointsSettings";
import { getStoreSettings } from "@/lib/settings";

export const metadata = { title: "Settings" };

/**
 * Read live rather than from the static file, so the form opens on whatever
 * the storefront is currently quoting — including a value saved a minute ago.
 */
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getStoreSettings();

  /*
   * The points panel reads and writes its own document through its own route,
   * so it is a sibling rather than another tab inside the store form — what a
   * point is worth is an administrator's control, and the store form is not.
   */
  return (
    <div className="space-y-4">
      <SettingsBoard settings={settings} />
      <PointsSettings />
    </div>
  );
}
