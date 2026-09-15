import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { SearchOverlay } from "@/components/layout/SearchOverlay";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { ConsentBanner } from "@/components/analytics/ConsentBanner";
import { GiftInvite } from "@/components/gift/GiftInvite";
import { PageTracker } from "@/components/analytics/PageTracker";
import { getStoreSettings } from "@/lib/settings";
import { getCategoryTree } from "@/lib/catalog";
import { isLocale } from "@/lib/i18n/config";
import type { Locale } from "@/types";

/**
 * Storefront shell.
 *
 * Everything a shopper browses lives under this layout: header, footer and the
 * mini cart. The `(focused)` group deliberately omits all three — during
 * checkout and sign-in, a nav bar full of exits is a leak, not a convenience.
 *
 * Only the announcement bar needs the locale as a prop, because it is a Server
 * Component reading merchandising copy out of Firestore. Everything else in the
 * shell is a Client Component and reads the locale from `LocaleProvider`.
 */
export default async function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";

  // The nav is a client island, so the tree is read here and passed down.
  const [categoryTree, settings] = await Promise.all([getCategoryTree(), getStoreSettings()]);

  return (
    <>
      {/* The announcement is passed into the header so the fixed bar cannot
          cover it, and so the two hide and return together on scroll. */}
      <Navbar
        announcement={<AnnouncementBar locale={locale} />}
        categoryTree={categoryTree}
      />
      {children}
      <Footer locale={locale} social={settings.social} />
      <CartDrawer locale={locale} />
      {/* Nothing is recorded until the banner has been answered — the guard
          lives in `track()`, so mounting the tracker is safe either way. */}
      <PageTracker />
      <ConsentBanner locale={locale} />
      <SearchOverlay locale={locale} />
      {/*
        The gift game comes to the customer once they are signed in, instead of
        waiting on a page nobody navigates to. It asks the server whether they
        may play before it renders anything, and asks once per turn.
      */}
      <GiftInvite locale={locale} />
    </>
  );
}
