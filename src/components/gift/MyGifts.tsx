"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { errorMessage } from "@/lib/errors";
import { useCoupon } from "@/lib/store/coupon";
import { t } from "@/lib/format";
import { Link } from "@/components/ui/Link";
import type { Locale, Localized, OfferType } from "@/types";

/**
 * "My gifts and coupons".
 *
 * Fetched from `/api/gift/mine` rather than read from Firestore directly: a
 * personal code assigned to one account must not be reachable in the
 * world-readable `offers` collection, so the only way to see it is to ask the
 * server as yourself.
 *
 * Applying a gift writes the code to the shared coupon store and sends the
 * customer to the bag — the same path a typed code takes, so the gift is
 * validated, limited and redeemed by exactly the same machinery rather than a
 * second discount mechanism with its own bugs.
 */

interface Gift {
  id: string;
  code: string;
  title: Localized;
  description: Localized | null;
  type: OfferType;
  value: number;
  minSubtotal: number | null;
  expiresAt: number;
  used: boolean;
  expired: boolean;
}

export function MyGifts({ locale = "en" }: { locale?: Locale }) {
  const rtl = locale === "ar";
  const router = useRouter();
  const setCoupon = useCoupon((s) => s.setCode);

  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/gift/mine", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await response.json()) as { ok?: boolean; gifts?: Gift[]; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not load your gifts.");
      setGifts(data.gifts ?? []);
    } catch (err) {
      setError(
        errorMessage(err, locale, {
          en: "Your gifts could not be loaded.",
          ar: "تعذّر تحميل هداياك.",
        }),
      );
      setGifts([]);
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  function apply(gift: Gift) {
    setCoupon(gift.code);
    router.push(`/${locale}/cart`);
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError(rtl ? "تعذّر النسخ." : "Could not copy.");
    }
  }

  if (gifts === null) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="ns-shimmer rounded-lg h-24" />
        ))}
      </div>
    );
  }

  if (gifts.length === 0) {
    return (
      <div className="border-line rounded-lg border p-6 text-center">
        <p className="text-smoke text-[0.9375rem]">
          {rtl ? "لا توجد هدايا بعد." : "No gifts yet."}
        </p>
        <Link
          href="/gift"
          className="text-brand mt-2 inline-block text-[0.8125rem] font-semibold underline-offset-4 hover:underline"
        >
          {rtl ? "جرّب عجلة الهدايا" : "Try the gift wheel"}
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
          {error}
        </p>
      )}

      <ul className="space-y-3">
        {gifts.map((gift) => {
          const usable = !gift.used && !gift.expired;
          return (
            <li
              key={gift.id}
              className={cn(
                "rounded-lg border p-4",
                usable ? "border-line" : "border-line/60 opacity-60",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-ink text-[0.9375rem] font-semibold">
                    {t(gift.title, locale)}
                  </p>
                  <p className="text-ink mt-1 font-mono text-[0.9375rem] tracking-wider">
                    {gift.code}
                  </p>

                  {gift.description && (
                    <p className="text-smoke mt-1.5 text-[0.75rem]">
                      {t(gift.description, locale)}
                    </p>
                  )}

                  {/* The conditions, stated on the gift itself rather than
                      discovered at the checkout. */}
                  <p className="text-mist mt-1.5 text-[0.75rem]">
                    {gift.minSubtotal
                      ? `${rtl ? "الحد الأدنى" : "Minimum"} ${formatPrice(gift.minSubtotal, "JOD", locale)} · `
                      : ""}
                    {gift.used
                      ? rtl
                        ? "مستخدمة"
                        : "Used"
                      : gift.expired
                        ? rtl
                          ? "منتهية"
                          : "Expired"
                        : `${rtl ? "تنتهي" : "Expires"} ${new Date(gift.expiresAt).toLocaleDateString(
                            rtl ? "ar-JO" : "en-JO",
                          )}`}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => copy(gift.code)}
                    className="border-line text-ink-muted hover:border-ink hover:text-ink rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors"
                    data-cursor="hover"
                  >
                    {copied === gift.code ? (rtl ? "نُسخ ✓" : "Copied ✓") : rtl ? "نسخ" : "Copy"}
                  </button>

                  {usable && (
                    <button
                      type="button"
                      onClick={() => apply(gift)}
                      className="bg-brand rounded-pill cursor-pointer px-3 py-1.5 text-[0.75rem] font-semibold text-white transition-colors hover:bg-brand-deep"
                      data-cursor="hover"
                    >
                      {rtl ? "استخدم" : "Apply"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
