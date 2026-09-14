"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { t } from "@/lib/format";
import type { Locale, Testimonial } from "@/types";

/**
 * Customer reviews.
 *
 * Masonry-ish columns rather than a carousel: every quote is readable at once,
 * nothing auto-advances out from under someone mid-sentence, and there is no
 * hidden content for a screen reader to miss. The "verified" marker is the
 * load-bearing element — an unverified testimonial is decoration.
 */
export function Testimonials({
  testimonials,
  locale = "en",
}: {
  testimonials: Testimonial[];
  locale?: Locale;
}) {
  const reduced = useReducedMotion();
  if (testimonials.length === 0) return null;

  return (
    <div className="columns-1 gap-4 sm:columns-2 md:gap-6 lg:columns-4">
      {testimonials.map((item, index) => (
        <motion.figure
          key={item.id}
          className={cn(
            "bg-paper-raised rounded-lg border-line mb-4 break-inside-avoid border p-6 md:mb-6",
            "shadow-lift transition-shadow duration-500 hover:shadow-float",
          )}
          initial={reduced ? undefined : { opacity: 0, y: 22 }}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-8%" }}
          transition={{ duration: 0.55, ease: EASE.brand, delay: index * 0.07 }}
        >
          <Stars rating={item.rating} />

          <blockquote className="text-ink mt-4 text-[0.9375rem] leading-relaxed text-pretty">
            {t(item.quote, locale)}
          </blockquote>

          <figcaption className="border-line mt-5 flex items-center justify-between border-t pt-4">
            <span className="text-ink text-[0.8125rem] font-medium">{item.name}</span>
            {item.verified && (
              <span className="text-mint inline-flex items-center gap-1 text-[0.6875rem]">
                <VerifiedIcon />
                {locale === "ar" ? "شراء موثّق" : "Verified buyer"}
              </span>
            )}
          </figcaption>
        </motion.figure>
      ))}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <svg key={star} width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 1.2 8.6 5h4.1l-3.3 2.5 1.2 3.9L7 9.1l-3.6 2.3 1.2-3.9L1.3 5h4.1L7 1.2Z"
            fill={star <= rating ? "var(--color-brand)" : "var(--color-line-strong)"}
          />
        </svg>
      ))}
    </div>
  );
}

function VerifiedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5.2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m3.8 6.2 1.5 1.5 3-3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
