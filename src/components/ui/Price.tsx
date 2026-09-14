import { cn } from "@/lib/utils";
import { discountPercent } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import type { CurrencyCode, Locale } from "@/types";

export interface PriceProps {
  value: number;
  compareAt?: number;
  currency?: CurrencyCode;
  locale?: Locale;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Show the "−25%" chip next to the struck-through original. */
  showDiscount?: boolean;
}

const SIZES = {
  sm: "text-[0.8125rem]",
  md: "text-[0.9375rem]",
  lg: "text-lg",
} as const;

/**
 * Price display.
 *
 * Tabular figures so a column of prices aligns and a value that animates does
 * not jitter. The original price is struck through and de-emphasised rather
 * than removed, because the saving is the argument.
 *
 * It wraps. A discounted price is three pieces — "JOD 349.000", the struck
 * "JOD 449.000", and the "−22%" chip — and in a card on a 375px screen those
 * do not fit on one line. Held on one line they pushed the whole document
 * 59px wider than the viewport, which is how one unbreakable row inside a
 * product card turns into a page that scrolls sideways on every phone.
 */
export function Price({
  value,
  compareAt,
  currency = "JOD",
  locale = "en",
  size = "md",
  className,
  showDiscount = true,
}: PriceProps) {
  const off = discountPercent(value, compareAt);
  const onSale = off > 0;

  return (
    <span
      className={cn(
        "tabular inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5",
        SIZES[size],
        className,
      )}
    >
      <span className={cn("font-medium whitespace-nowrap", onSale && "text-alert")}>
        {formatPrice(value, currency, locale)}
      </span>

      {onSale && (
        <>
          <span className="text-mist text-[0.85em] whitespace-nowrap line-through">
            {formatPrice(compareAt!, currency, locale)}
          </span>
          {showDiscount && (
            <span className="text-alert bg-alert/10 rounded-xs px-1.5 py-0.5 text-[0.7em] font-semibold whitespace-nowrap">
              −{off}%
            </span>
          )}
        </>
      )}
    </span>
  );
}
