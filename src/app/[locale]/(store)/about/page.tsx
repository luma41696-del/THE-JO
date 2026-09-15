import type { Metadata } from "next";

import { Link } from "@/components/ui/Link";
import { PageIntro } from "@/components/ui/PageIntro";
import { policiesIn, storeSettings } from "@/data/site-content";
import { LOCALES, isLocale } from "@/lib/i18n/config";
import { t } from "@/lib/format";
import type { Locale } from "@/types";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const rtl = isLocale(raw) && raw === "ar";
  return {
    title: rtl ? "عن المتجر" : "About",
    description: rtl
      ? "من نحن، وكيف نختار ما نبيعه."
      : "Who we are, and how we choose what we sell.",
  };
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const rtl = locale === "ar";
  const pages = policiesIn("about");

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={rtl ? "عن المتجر" : "About"}
        title={rtl ? "متجر صغير، عن قصد" : "A small shop, on purpose"}
        description={
          rtl
            ? "نبيع قطعاً قليلة نعرف منشأها، بأسعار صافية."
            : "We sell a short list of pieces whose origin we know, at net prices."
        }
      />

      <div className="ns-container pb-20 md:pb-28">
        <div className="max-w-[65ch]">
          <p className="text-ink-muted text-[0.9375rem] leading-relaxed text-pretty">
            {rtl
              ? "الاسم يعد بشيء واحد: السعر الذي تدفعه هو كلفة القطعة وهامش معقول، لا رقم مُضخَّم يُشطب لاحقاً ليبدو تخفيضاً. ولأن ذلك سهل القول وصعب الإثبات، نذكر تركيبة كل قطعة ومدينة مصنعها في صفحتها، ونترك ما لا نعرفه فارغاً."
              : "The name promises one thing: the price you pay is what the piece costs plus a reasonable margin — not an inflated figure struck through later to look like a discount. That is easy to say and hard to prove, so every product page names its composition and the mill's city, and leaves blank what we do not know."}
          </p>

          <nav className="mt-10" aria-label={rtl ? "المزيد" : "More"}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {pages.map((doc) => (
                <li key={doc.slug}>
                  <Link
                    href={`/about/${doc.slug}`}
                    className="border-line hover:border-ink block rounded-lg border p-4 transition-colors"
                    data-cursor="hover"
                  >
                    <span className="font-display text-ink block text-[1.0625rem] font-semibold">
                      {t(doc.title, locale)}
                    </span>
                    <span className="text-smoke mt-1 block text-[0.8125rem]">
                      {t(doc.intro, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="border-line mt-10 border-t pt-6">
            <p className="text-eyebrow font-display text-mist mb-2 uppercase">
              {rtl ? "تواصل" : "Contact"}
            </p>
            <p className="text-ink-muted text-[0.875rem]">
              {storeSettings.contact.email} · {storeSettings.contact.phone}
            </p>
            <p className="text-mist mt-1 text-[0.8125rem]">
              {t(storeSettings.contact.hours, locale)}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
