import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/AuthForm";
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
  return { title: t.auth.signIn, description: t.auth.signUpBody, robots: { index: false, follow: false } };
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";

  // `AuthForm` reads `?next=` via `useSearchParams`, which requires a Suspense
  // boundary so the rest of the route can still be statically rendered.
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <AuthForm mode="signin" locale={locale} />
    </Suspense>
  );
}
