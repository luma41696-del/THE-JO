"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Link } from "@/components/ui/Link";
import { transition } from "@/lib/motion";
import { useConsent } from "@/lib/analytics/consent";
import type { Locale } from "@/types";

/**
 * The consent banner.
 *
 * Two buttons, the same size, the same prominence. "Decline" is not a text
 * link hiding under a primary "Accept all", and there is no third path through
 * a preferences maze — a decline that takes four taps is a decline the design
 * is trying to prevent, and that is not consent.
 *
 * It appears only after mount. Rendering it server-side would flash a banner
 * at a visitor who decided months ago, because the stored choice lives in
 * `localStorage` and the server cannot see it.
 *
 * Fitting-room consent is **not** asked for here. It is asked at the point the
 * fitting room needs a photograph, where the question is concrete and the
 * answer is informed — bundling it into a site-wide banner would collect a
 * permission for body images from someone who was trying to dismiss a cookie
 * notice.
 */
export function ConsentBanner({ locale = "en" }: { locale?: Locale }) {
  const rtl = locale === "ar";
  const [mounted, setMounted] = useState(false);

  const decided = useConsent((s) => s.decidedAt > 0);
  const acceptAll = useConsent((s) => s.acceptAll);
  const rejectAll = useConsent((s) => s.rejectAll);

  useEffect(() => setMounted(true), []);

  const show = mounted && !decided;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="dialog"
          aria-label={rtl ? "إعدادات الخصوصية" : "Privacy choices"}
          className="fixed inset-x-0 bottom-0 z-[130] p-3 md:p-4"
          initial={{ y: "120%" }}
          animate={{ y: 0 }}
          exit={{ y: "120%" }}
          transition={transition.drawer}
        >
          <div className="bg-paper-raised border-line shadow-float rounded-xl mx-auto flex max-w-3xl flex-col gap-4 border p-4 md:flex-row md:items-center md:p-5">
            <div className="min-w-0 flex-1">
              <p className="text-ink text-[0.875rem] font-medium">
                {rtl ? "نقيس كيف يُستخدم المتجر" : "We measure how the shop is used"}
              </p>
              <p className="text-smoke mt-1 text-[0.8125rem]">
                {rtl
                  ? "لتحسين الصفحات والبحث. لا نسجّل عنوانك ولا بيانات الدفع ولا قياساتك."
                  : "To improve the pages and the search. We never record your address, payment details or measurements."}{" "}
                <Link
                  href="/legal/privacy"
                  className="text-brand underline-offset-4 hover:underline"
                >
                  {rtl ? "الخصوصية" : "Privacy"}
                </Link>
              </p>
            </div>

            {/* Equal weight, equal size. */}
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={rejectAll}
                className="border-line text-ink hover:border-ink flex-1 cursor-pointer rounded-pill border px-5 py-2.5 text-[0.8125rem] font-semibold transition-colors md:flex-none"
                data-cursor="hover"
              >
                {rtl ? "رفض" : "Decline"}
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="bg-ink hover:bg-ink-soft flex-1 cursor-pointer rounded-pill px-5 py-2.5 text-[0.8125rem] font-semibold text-white transition-colors md:flex-none"
                data-cursor="hover"
              >
                {rtl ? "موافق" : "Accept"}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
