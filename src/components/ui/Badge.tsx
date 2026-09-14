import { cn } from "@/lib/utils";
import type { Locale, ProductBadge } from "@/types";

const LABELS: Record<ProductBadge, Record<Locale, string>> = {
  new: { en: "New", ar: "جديد" },
  bestseller: { en: "Bestseller", ar: "الأكثر مبيعاً" },
  limited: { en: "Limited", ar: "محدود" },
  "last-pieces": { en: "Last pieces", ar: "آخر القطع" },
  exclusive: { en: "Exclusive", ar: "حصري" },
  restocked: { en: "Back in stock", ar: "عاد للمخزون" },
};

/** Tone is meaning, not decoration: alert is always scarcity, brand always brand. */
const TONES: Record<ProductBadge, string> = {
  new: "bg-ink text-white",
  bestseller: "bg-brand text-white",
  limited: "bg-brand-mist text-brand-deep",
  "last-pieces": "bg-alert text-white",
  exclusive: "bg-sand text-ink",
  restocked: "bg-mint/12 text-mint",
};

export function Badge({
  badge,
  locale = "en",
  className,
}: {
  badge: ProductBadge;
  locale?: Locale;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-display rounded-pill inline-flex items-center px-2.5 py-1",
        "text-[0.625rem] font-semibold tracking-[0.14em] uppercase",
        TONES[badge],
        className,
      )}
    >
      {LABELS[badge][locale]}
    </span>
  );
}

export function Chip({
  children,
  active = false,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-pill cursor-pointer border px-4 py-2 text-[0.8125rem] transition-all duration-300",
        active
          ? "border-ink bg-ink text-white"
          : "border-line text-ink-muted hover:border-ink/40 hover:text-ink bg-paper-raised",
        className,
      )}
      data-cursor="hover"
      {...props}
    >
      {children}
    </button>
  );
}
