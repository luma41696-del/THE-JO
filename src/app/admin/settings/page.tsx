import { SettingsBoard } from "@/components/admin/SettingsBoard";
import { getStoreSettings } from "@/lib/settings";

export const metadata = { title: "Settings" };

/**
 * Read live rather than from the static file, so the form opens on whatever
 * the storefront is currently quoting — including a value saved a minute ago.
 */
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getStoreSettings();
  return <SettingsBoard settings={settings} />;
}
