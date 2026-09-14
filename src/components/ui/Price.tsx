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
    <span className={cn("tabular inline-flex items-baseline gap-2", SIZES[size], className)}>
      <span className={cn("font-medium", onSale && "text-alert")}>
        {formatPrice(value, currency, locale)}
      </span>

      {onSale && (
        <>
          <span className="text-mist text-[0.85em] line-through">
            {formatPrice(compareAt!, currency, locale)}
          </span>
          {showDiscount && (
            <span className="text-alert bg-alert/10 rounded-xs px-1.5 py-0.5 text-[0.7em] font-semibold">
              −{off}%
            </span>
          )}
        </>
      )}
    </span>
  );
}
