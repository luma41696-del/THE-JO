import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { SearchOverlay } from "@/components/layout/SearchOverlay";
import { CartDrawer } from "@/components/cart/CartDrawer";
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
  const categoryTree = await getCategoryTree();

  return (
    <>
      {/* The announcement is passed into the header so the fixed bar cannot
          cover it, and so the two hide and return together on scroll. */}
      <Navbar
        announcement={<AnnouncementBar locale={locale} />}
        categoryTree={categoryTree}
      />
      {children}
      <Footer locale={locale} />
      <CartDrawer locale={locale} />
      <SearchOverlay locale={locale} />
    </>
  );
}
