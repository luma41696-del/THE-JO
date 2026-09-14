"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { ProductCard } from "./ProductCard";
import type { Locale, Product } from "@/types";

/**
 * Horizontal product rail.
 *
 * Native scroll with snap points rather than a JS carousel: it keeps momentum
 * scrolling, trackpad gestures, keyboard navigation and screen-reader reading
 * order for free, and it costs no JavaScript to render. The arrow buttons only
 * add a convenience for mouse users, and they hide when there is nothing left
 * to scroll to in that direction.
 */

export interface ProductRailProps {
  products: Product[];
  locale?: Locale;
  className?: string;
}

export function ProductRail({ products, locale = "en", className }: ProductRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  function updateEdges() {
    const el = trackRef.current;
    if (!el) return;
    // `scrollLeft` is negative in RTL on most engines; abs() normalises it.
    const left = Math.abs(el.scrollLeft);
    setAtStart(left < 8);
    setAtEnd(left + el.clientWidth >= el.scrollWidth - 8);
  }

  function scrollBy(direction: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: direction * (rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={trackRef}
        onScroll={updateEdges}
        className={cn(
          "jo-no-scrollbar -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 md:-mx-10 md:gap-6 md:px-10",
          "scroll-smooth",
        )}
      >
        {products.map((product, index) => (
          <div
            key={product.id}
            className="w-[68vw] shrink-0 snap-start sm:w-[42vw] md:w-[31vw] lg:w-[23vw] xl:w-[19rem]"
          >
            <ProductCard product={product} locale={locale} index={index} />
          </div>
        ))}
      </div>

      {/* Mouse affordances. Hidden from assistive tech — the track itself is
          already keyboard scrollable and in correct reading order. */}
      <div className="pointer-events-none absolute inset-y-0 end-0 start-0 hidden items-center justify-between lg:flex">
        <RailButton
          direction="prev"
          onClick={() => scrollBy(-1)}
          hidden={atStart}
          locale={locale}
        />
        <RailButton direction="next" onClick={() => scrollBy(1)} hidden={atEnd} locale={locale} />
      </div>
    </div>
  );
}

function RailButton({
  direction,
  onClick,
  hidden,
  locale,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  hidden: boolean;
  locale: Locale;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      aria-hidden="true"
      className={cn(
        "jo-glass shadow-float pointer-events-auto grid h-11 w-11 place-items-center rounded-full",
        "text-ink cursor-pointer transition-all duration-300",
        direction === "prev" ? "-ms-3" : "-me-3",
        hidden && "pointer-events-none scale-90 opacity-0",
      )}
      data-cursor="hover"
    >
      <span className={cn("text-lg", direction === "prev" ? "rtl:rotate-180" : "rtl:rotate-180")}>
        {direction === "prev" ? "←" : "→"}
      </span>
      <span className="sr-only">
        {direction === "prev"
          ? locale === "ar"
            ? "السابق"
            : "Previous"
          : locale === "ar"
            ? "التالي"
            : "Next"}
      </span>
    </button>
  );
}
