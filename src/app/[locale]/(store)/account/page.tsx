import type { Metadata } from "next";

import { AccountPanel } from "@/components/account/AccountPanel";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";
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
        {/*
          Inside the auth gate, so it is never shown to a visitor who is not
          signed in — and above the panel, because it is the one thing on this
          page that is asking the customer to do something.
        */}
        <div className="mx-auto mb-6 max-w-5xl px-6">
          <VerifyEmailBanner locale={locale} />
        </div>
        <AccountPanel locale={locale} />
      </RequireAuth>
    </>
  );
}
