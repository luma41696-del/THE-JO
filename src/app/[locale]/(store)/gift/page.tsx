import type { Metadata } from "next";

import { GiftWheel } from "@/components/gift/GiftWheel";
import { MyGifts } from "@/components/gift/MyGifts";
import { PageIntro } from "@/components/ui/PageIntro";
import { getActiveGiftCampaign } from "@/lib/catalog";
import { isLocale } from "@/lib/i18n/config";
import type { Locale } from "@/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const rtl = isLocale(raw) && raw === "ar";
  return {
    title: rtl ? "عجلة الهدايا" : "Gift wheel",
    description: rtl ? "أدر العجلة واربح خصماً." : "Spin the wheel for a discount.",
  };
}

/**
 * The game is never cached: eligibility depends on when this customer last
 * played, and a cached page would show a spinnable wheel to someone who is in
 * a cooldown.
 */
export const dynamic = "force-dynamic";

export default async function GiftPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const rtl = locale === "ar";

  const campaign = await getActiveGiftCampaign();

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={rtl ? "هدية" : "A gift"}
        title={rtl ? "عجلة الهدايا" : "The gift wheel"}
        description={
          rtl
            ? "دورة واحدة كل يوم. الجائزة تُحفظ في حسابك فوراً."
            : "One spin a day. Whatever you win is saved to your account straight away."
        }
      />

      <div className="ns-container pb-20 md:pb-28">
        {campaign ? (
          /*
           * `signedIn` is deliberately false here and corrected on the client:
           * this page is dynamic but not authenticated server-side, and
           * guessing would either hide the wheel from a signed-in customer or
           * promise a spin to a signed-out one. The component asks the auth
           * provider itself.
           */
          <GiftWheel campaign={campaign} locale={locale} signedIn />
        ) : (
          <p className="text-smoke mx-auto max-w-md text-center text-[0.9375rem]">
            {rtl
              ? "لا توجد لعبة جارية حالياً. عد قريباً."
              : "No game is running right now. Check back soon."}
          </p>
        )}

        <section className="mx-auto mt-16 max-w-2xl">
          <h2 className="font-display text-ink mb-4 text-xl font-semibold tracking-tight">
            {rtl ? "هداياي وكوبوناتي" : "My gifts and coupons"}
          </h2>
          <MyGifts locale={locale} />
        </section>
      </div>
    </>
  );
}
