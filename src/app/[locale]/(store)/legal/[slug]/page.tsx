import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PolicyArticle } from "@/components/content/PolicyArticle";
import { buildPolicyDocs, findPolicy, policiesIn } from "@/data/site-content";
import { getStoreSettings } from "@/lib/settings";
import { LOCALES, isLocale } from "@/lib/i18n/config";
import { t } from "@/lib/format";
import type { Locale } from "@/types";

const GROUP = "legal" as const;

/**
 * Policy pages are static content that changes a few times a year, so every
 * one is pre-rendered in both languages. Nine documents that used to 404 are
 * nine fewer dead ends for a customer who is already having a problem.
 */
export function generateStaticParams() {
  return LOCALES.flatMap((locale) =>
    policiesIn(GROUP).map((doc) => ({ locale, slug: doc.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const doc = findPolicy(GROUP, slug);
  if (!doc) return {};
  return { title: t(doc.title, locale), description: t(doc.intro, locale) };
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  /*
   * Built from the live settings, so the returns window on this page is the
   * one the shop currently honours rather than the one that was in the repo
   * when it was last deployed.
   */
  const doc = findPolicy(GROUP, slug, buildPolicyDocs(await getStoreSettings()));
  if (!doc) notFound();

  return <PolicyArticle doc={doc} locale={locale} />;
}
