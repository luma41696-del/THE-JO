"use client";

import { useRef } from "react";
import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

import { EASE } from "@/lib/motion";
import { Reveal } from "@/components/ui/Reveal";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";
import type { Locale } from "@/types";

/**
 * Brand story.
 *
 * An editorial two-column spread: the image column parallaxes against the copy
 * as the section passes, which is the cheapest way to make a static page feel
 * like it has depth. The three numbers at the bottom are the actual argument —
 * a brand story with no specifics is wallpaper.
 */
export function BrandStory({ locale = "en" }: { locale?: Locale }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const rtl = locale === "ar";

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const imageY = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [60, -60]);
  const plateY = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [-40, 40]);

  return (
    <section ref={ref} className="relative">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
        {/* Imagery */}
        <div className="relative aspect-[4/5] max-h-[38rem]">
          <motion.div
            className="rounded-2xl absolute inset-x-8 inset-y-0 overflow-hidden"
            style={{ y: imageY }}
          >
            <Image
              src="/demo/campaign-sand.svg"
              alt=""
              fill
              sizes="(max-width: 1024px) 90vw, 45vw"
              className="object-cover"
            />
          </motion.div>

          <motion.div
            className="jo-glass rounded-xl shadow-float absolute bottom-6 start-0 w-56 p-5"
            style={{ y: plateY }}
          >
            <AnimatedLogo className="h-10 w-10" intro={false} title={null} />
            <p className="text-ink mt-4 text-[0.8125rem] leading-relaxed">
              {rtl
                ? "من أول قصّة إلى آخر غرزة، كل قطعة تمرّ على يد إنسان."
                : "From first cut to last stitch, every piece passes through a person's hands."}
            </p>
          </motion.div>
        </div>

        {/* Copy */}
        <div>
          <Reveal>
            <p className="text-eyebrow font-display text-violet mb-5 uppercase">
              {rtl ? "قصتنا" : "Our story"}
            </p>
          </Reveal>

          <Reveal mask distance={48}>
            <h2 className="text-display font-display text-ink text-balance">
              {rtl ? "أقل قطعاً، وأطول عمراً" : "Fewer pieces, longer lives"}
            </h2>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="text-ink-muted mt-6 space-y-4 text-pretty md:text-[1.0625rem]">
              <p>
                {rtl
                  ? "بدأت ذاجو بسؤال بسيط: لماذا تُصنع أغلب الملابس لتدوم موسماً واحداً؟ اخترنا الطريق الأبطأ — مصانع أقل، أقمشة أثقل، ودفعات محدودة."
                  : "THE JO started with a blunt question: why is most clothing built to last one season? We took the slower route — fewer mills, heavier cloth, deliberately small runs."}
              </p>
              <p>
                {rtl
                  ? "نعمل مباشرة مع مصانع في بييلا وكومو وبورتو، بلا وسطاء. القطعة التي تصلك اليوم صُمّمت لتبقى في خزانتك بعد عشر سنوات."
                  : "We work direct with mills in Biella, Como and Porto, with nobody in between. The piece that arrives today is meant to still be in your wardrobe in ten years."}
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.16}>
            <dl className="border-line mt-10 grid grid-cols-3 gap-6 border-t pt-8">
              {[
                { value: "12", label: { en: "pieces per season", ar: "قطعة في الموسم" } },
                { value: "3", label: { en: "partner mills", ar: "مصانع شريكة" } },
                { value: "10y", label: { en: "design lifespan", ar: "عمر التصميم" } },
              ].map((stat, index) => (
                <motion.div
                  key={stat.value}
                  initial={reduced ? undefined : { opacity: 0, y: 14 }}
                  whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.08, duration: 0.5, ease: EASE.jo }}
                >
                  <dt className="font-display text-ink text-3xl font-semibold tabular-nums">
                    {stat.value}
                  </dt>
                  <dd className="text-smoke mt-1 text-[0.75rem]">{stat.label[locale]}</dd>
                </motion.div>
              ))}
            </dl>
          </Reveal>

          <Reveal delay={0.22}>
            <Link
              href="/about"
              className="font-display jo-underline text-ink mt-9 inline-flex items-center gap-2 text-sm font-semibold tracking-[0.08em] uppercase"
              data-cursor="hover"
            >
              {rtl ? "اقرأ القصة كاملة" : "Read the full story"}
              <span aria-hidden="true" className="rtl:rotate-180">
                →
              </span>
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
