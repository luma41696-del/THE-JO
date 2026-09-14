import type { Metadata } from "next";

import { AccountPanel } from "@/components/account/AccountPanel";
import { RequireAuth } from "@/components/account/RequireAuth";
import { PageIntro } from "@/components/ui/PageIntro";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const t = getDictionary(isLocale(raw) ? raw : "en");
  return { title: t.account.title, robots: { index: false, follow: false } };
}

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  return (
    <>
      <PageIntro locale={locale} eyebrow={t.account.eyebrow} title={t.account.title} />
      <RequireAuth locale={locale}>
        <AccountPanel locale={locale} />
      </RequireAuth>
    </>
  );
}
