import { Link } from "@/components/ui/Link";
import { PageIntro } from "@/components/ui/PageIntro";
import { t } from "@/lib/format";
import { policiesIn, type PolicyDoc } from "@/data/site-content";
import type { Locale } from "@/types";

/**
 * A policy or help document.
 *
 * Set as an article rather than a marketing page: measure capped near 65
 * characters, real headings, and no decorative furniture. These are pages
 * someone reads because something went wrong with an order, and every
 * flourish between them and the answer is a cost.
 *
 * Sibling documents are listed at the foot, because a customer reading the
 * returns policy is one question away from wanting the delivery one.
 */
export function PolicyArticle({ doc, locale = "en" }: { doc: PolicyDoc; locale?: Locale }) {
  const siblings = policiesIn(doc.group).filter((d) => d.slug !== doc.slug);
  const rtl = locale === "ar";

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={t(doc.eyebrow, locale)}
        title={t(doc.title, locale)}
        description={t(doc.intro, locale)}
      />

      <div className="ns-container pb-20 md:pb-28">
        <article className="max-w-[65ch]">
          {doc.sections.map((section) => (
            <section key={section.heading.en} className="mt-10 first:mt-0">
              <h2 className="font-display text-ink text-xl font-semibold tracking-tight text-balance">
                {t(section.heading, locale)}
              </h2>
              {section.body.map((paragraph, index) => (
                <p
                  key={index}
                  className="text-ink-muted mt-3 text-[0.9375rem] leading-relaxed text-pretty"
                >
                  {t(paragraph, locale)}
                </p>
              ))}
            </section>
          ))}

          {/* An undated policy is not a policy — it is a claim with no version. */}
          <p className="text-mist border-line mt-12 border-t pt-5 text-[0.75rem]">
            {rtl ? "آخر مراجعة" : "Last reviewed"}{" "}
            <time dateTime={doc.updatedAt} className="tabular-nums">
              {doc.updatedAt}
            </time>
          </p>

          {siblings.length > 0 && (
            <nav className="mt-8" aria-label={rtl ? "صفحات ذات صلة" : "Related pages"}>
              <p className="text-eyebrow font-display text-mist mb-3 uppercase">
                {rtl ? "اقرأ أيضاً" : "Also here"}
              </p>
              <ul className="flex flex-wrap gap-2">
                {siblings.map((sibling) => (
                  <li key={sibling.slug}>
                    <Link
                      href={`/${sibling.group}/${sibling.slug}`}
                      className="border-line text-ink hover:border-ink rounded-pill border px-3.5 py-1.5 text-[0.8125rem] transition-colors"
                      data-cursor="hover"
                    >
                      {t(sibling.title, locale)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </article>
      </div>
    </>
  );
}
