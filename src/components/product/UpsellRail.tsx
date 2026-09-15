import Image from "next/image";

import { Link } from "@/components/ui/Link";
import { Price } from "@/components/ui/Price";
import { Reveal } from "@/components/ui/Reveal";
import { formatPrice, t } from "@/lib/format";
import type { Locale, Product } from "@/types";

/**
 * Upsell rail — "instead of this".
 *
 * Deliberately not a copy of the related-products rail. A cross-sell rail is
 * browsing: several cards, equal weight, keep looking. An upsell is a single
 * comparison, and the only question it has to answer is *what do I get for the
 * difference*. So each row states the upgrade in money — "+34.000 JOD" — and
 * names the reason, rather than showing a price the customer has to subtract
 * from the one they were just looking at.
 *
 * Server-rendered: nothing here is interactive beyond a link, and a client
 * bundle for three static rows is not worth the bytes.
 */

export interface UpsellRailProps {
  products: Product[];
  /** The product being viewed — the baseline every difference is measured from. */
  current: Product;
  locale?: Locale;
}

export function UpsellRail({ products, current, locale = "en" }: UpsellRailProps) {
  if (products.length === 0) return null;
  const rtl = locale === "ar";

  return (
    <section className="ns-container pb-16 md:pb-24" aria-labelledby="upsell-heading">
      <Reveal>
        <div className="border-line rounded-xl border p-5 md:p-8">
          <p className="text-eyebrow text-brand mb-2 uppercase">
            {rtl ? "ترقية" : "Consider the upgrade"}
          </p>
          <h2
            id="upsell-heading"
            className="font-display text-ink text-xl font-semibold tracking-tight text-balance md:text-2xl"
          >
            {rtl ? "قطعة أقرب لما تبحث عنه" : "A step up from this one"}
          </h2>

          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {products.map((product) => {
              const difference = product.price - current.price;

              return (
                <li key={product.id}>
                  <Link
                    href={`/product/${product.slug}`}
                    className="group border-line hover:border-ink/35 flex items-center gap-4 rounded-lg border p-3 transition-colors"
                    data-cursor="hover"
                  >
                    <span className="bg-paper-sunken rounded-md relative h-24 w-20 shrink-0 overflow-hidden">
                      {product.images[0] && (
                        <Image
                          src={product.images[0].url}
                          alt=""
                          fill
                          sizes="80px"
                          className="object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="text-ink block truncate text-[0.9375rem] font-medium">
                        {t(product.title, locale)}
                      </span>
                      {product.subtitle && (
                        <span className="text-smoke mt-0.5 block truncate text-[0.8125rem]">
                          {t(product.subtitle, locale)}
                        </span>
                      )}

                      <span className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <Price
                          value={product.price}
                          currency={product.currency}
                          locale={locale}
                          size="sm"
                        />
                        {/* The number that actually decides it. */}
                        {difference > 0 && (
                          <span className="text-brand bg-brand-mist rounded-xs px-1.5 py-0.5 text-[0.75rem] font-semibold whitespace-nowrap tabular-nums">
                            +{formatPrice(difference, product.currency, locale)}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </Reveal>
    </section>
  );
}
