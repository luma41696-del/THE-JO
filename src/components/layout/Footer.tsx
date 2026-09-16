import { Link } from "@/components/ui/Link";

import { NetSaleLockup } from "@/components/brand/NetSaleLockup";
import { BrandWave } from "@/components/brand/BrandWave";
import { Reveal } from "@/components/ui/Reveal";
import type { Locale } from "@/types";

/**
 * Site footer.
 *
 * Dark, generous, and treated as a closing statement rather than a sitemap
 * dump: the brand mark is set large, the ripple field runs quietly behind it,
 * and the link columns are grouped by intent (Shop / Help / Company) so a
 * customer looking for returns does not have to read thirty links.
 */

const COLUMNS: {
  title: Record<Locale, string>;
  links: { href: string; label: Record<Locale, string> }[];
}[] = [
  {
    title: { en: "Shop", ar: "تسوّق" },
    links: [
      { href: "/shop?sort=newest", label: { en: "New in", ar: "وصل حديثاً" } },
      { href: "/categories", label: { en: "Categories", ar: "الأقسام" } },
      { href: "/shop?badge=bestseller", label: { en: "Bestsellers", ar: "الأكثر مبيعاً" } },
      { href: "/shop?onSale=true", label: { en: "Offers", ar: "العروض" } },
      { href: "/fitting-room", label: { en: "AI Fitting Room", ar: "غرفة القياس" } },
    ],
  },
  {
    title: { en: "Help", ar: "المساعدة" },
    links: [
      { href: "/orders", label: { en: "Track an order", ar: "تتبّع طلبك" } },
      { href: "/help/shipping", label: { en: "Shipping", ar: "الشحن" } },
      { href: "/help/returns", label: { en: "Returns & exchanges", ar: "الإرجاع والاستبدال" } },
      { href: "/help/sizing", label: { en: "Size guide", ar: "دليل المقاسات" } },
      { href: "/help/contact", label: { en: "Contact", ar: "تواصل معنا" } },
    ],
  },
  {
    title: { en: "Company", ar: "الشركة" },
    links: [
      { href: "/about", label: { en: "Our story", ar: "قصتنا" } },
      { href: "/about/materials", label: { en: "Materials", ar: "الخامات" } },
      { href: "/about/responsibility", label: { en: "Responsibility", ar: "الاستدامة" } },
      { href: "/legal/privacy", label: { en: "Privacy", ar: "الخصوصية" } },
      { href: "/legal/terms", label: { en: "Terms", ar: "الشروط" } },
    ],
  },
];

export function Footer({
  locale = "en",
  social = [],
}: {
  locale?: Locale;
  /**
   * The shop's own accounts, from store settings.
   *
   * These used to be three hard-coded links to `instagram.com`,
   * `tiktok.com` and `pinterest.com` — the platforms' front doors, not net
   * sale's profiles. A link labelled "Instagram" that lands on Instagram's
   * homepage is a dead end wearing the shop's name, and Pinterest was an
   * account that does not exist at all.
   */
  social?: { label: string; href: string }[];
}) {
  const rtl = locale === "ar";
  const year = new Date().getFullYear();

  return (
    <footer className="bg-ink relative mt-24 overflow-hidden text-white md:mt-32">
      {/* Ambient ripple, clipped by the footer. Purely decorative. */}
      <div className="pointer-events-none absolute -end-24 -top-32 h-[32rem] w-[32rem] opacity-[0.13]">
        <BrandWave rings={4} color="var(--color-brand-bright)" speed={14} />
      </div>

      <div className="ns-container relative py-16 md:py-24">
        <div className="grid gap-14 lg:grid-cols-[1.2fr_2fr]">
          {/* Brand block */}
          <Reveal>
            <div className="max-w-sm">
              <NetSaleLockup tone="onDark" variant="full" markClassName="h-11 w-11" />
              <p className="text-white/55 mt-6 text-[0.9375rem] leading-relaxed">
                {rtl
                  ? "قطع مصنوعة لتبقى. من مصانع مختارة في إيطاليا والبرتغال، وتصل إليك خلال أيام."
                  : "Pieces made to outlast the season. Cut in selected mills across Italy and Portugal, delivered in days."}
              </p>

              {/* Nothing at all when the shop has listed no accounts — an
                  empty row of buttons is worse than no row. */}
              {social.length > 0 && (
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  {social.map((network) => (
                    <a
                      key={network.href}
                      href={network.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-pill border border-white/15 px-4 py-2 text-[0.6875rem] tracking-[0.14em] text-white/70 uppercase transition-colors hover:border-white/40 hover:text-white"
                      data-cursor="hover"
                    >
                      {network.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </Reveal>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {COLUMNS.map((column, index) => (
              <Reveal key={column.title.en} delay={index * 0.06}>
                <div>
                  <h3 className="text-eyebrow mb-5 text-white/45 uppercase">
                    {column.title[locale]}
                  </h3>
                  <ul className="space-y-3">
                    {column.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="ns-underline text-[0.875rem] text-white/75 transition-colors hover:text-white"
                          data-cursor="hover"
                        >
                          {link.label[locale]}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Trust row */}
        <div className="mt-16 grid gap-4 border-t border-white/10 pt-8 sm:grid-cols-3">
          {[
            {
              en: ["Free returns", "30 days, no questions"],
              ar: ["إرجاع مجاني", "٣٠ يوماً دون أسئلة"],
            },
            {
              en: ["Secure checkout", "3-D Secure on every card"],
              ar: ["دفع آمن", "حماية 3-D Secure لكل بطاقة"],
            },
            {
              en: ["Real people", "Reply within 4 hours"],
              ar: ["دعم بشري", "رد خلال ٤ ساعات"],
            },
          ].map((item) => (
            <div key={item.en[0]}>
              <p className="text-[0.8125rem] font-medium text-white">{item[locale][0]}</p>
              <p className="mt-1 text-[0.75rem] text-white/45">{item[locale][1]}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-8 text-[0.75rem] text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} net sale — نت سيل. {rtl ? "جميع الحقوق محفوظة." : "All rights reserved."}
          </p>
          {/*
            The credit, as a real link.

            `rel="noopener"` because it opens in a new tab and a target without
            it hands the opened page a reference back to this one. `noreferrer`
            is deliberately not added: this is a credit, and the referrer is
            the part that makes it worth anything to whoever built the shop.
          */}
          <p className="tracking-[0.1em] uppercase">
            {rtl ? "برمجة وتطوير " : "Built and developed by "}
            <a
              href="https://www.luma-jo.com/"
              target="_blank"
              rel="noopener"
              className="text-ink hover:text-brand underline underline-offset-2 transition-colors"
              data-cursor="hover"
            >
              LUMA AGENCY
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
