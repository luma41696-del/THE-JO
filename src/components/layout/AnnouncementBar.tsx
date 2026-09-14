import { t } from "@/lib/format";
import { getBanners } from "@/lib/catalog";
import type { Locale } from "@/types";
import { Marquee } from "@/components/ui/Marquee";

/**
 * Top announcement strip.
 *
 * A server component — the copy comes from the `banners` collection, so
 * marketing changes it without a deploy. Renders nothing at all when no
 * announcement is scheduled, rather than reserving empty space.
 */
export async function AnnouncementBar({ locale = "en" }: { locale?: Locale }) {
  const banners = await getBanners("announcement");
  if (banners.length === 0) return null;

  const messages = banners.map((banner) => t(banner.title, locale));

  return (
    <div className="bg-ink text-white">
      <Marquee
        speed={38}
        className="py-2.5 text-[0.6875rem] tracking-[0.18em] uppercase"
        items={messages}
      />
    </div>
  );
}
