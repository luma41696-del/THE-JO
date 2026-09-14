import { cn } from "@/lib/utils";
import { NetSaleMark, type MarkTone } from "./NetSaleMark";

export interface NetSaleLockupProps {
  tone?: MarkTone;
  /** `full` adds the Arabic wordmark beneath the Latin; `mark` is the pebble only. */
  variant?: "full" | "compact" | "mark";
  className?: string;
  markClassName?: string;
}

/**
 * The horizontal lockup: mark, Latin wordmark, Arabic wordmark.
 *
 * The Latin wordmark is set **lowercase**, because that is how the logo is
 * drawn. Uppercasing it — the reflex for a nav bar — would contradict the
 * artwork sitting directly beside it.
 *
 * The Arabic sits *under* the Latin at a smaller optical size rather than
 * beside it: Arabic letterforms carry more visual weight per character, so
 * setting the two at the same size makes the Latin look starved.
 */
export function NetSaleLockup({
  tone = "onLight",
  variant = "full",
  className,
  markClassName,
}: NetSaleLockupProps) {
  const wordColor = tone === "onDark" ? "text-paper" : "text-ink";
  const arColor = tone === "onDark" ? "text-brand-bright" : "text-brand";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <NetSaleMark tone={tone} className={cn("h-9 w-9 shrink-0", markClassName)} title={null} />

      {variant !== "mark" && (
        <span className="flex flex-col leading-none">
          <span
            className={cn(
              "font-display text-[1.0625rem] font-semibold tracking-[0.02em] lowercase",
              wordColor,
            )}
          >
            net sale
          </span>
          {variant === "full" && (
            <span
              lang="ar"
              dir="rtl"
              className={cn("font-arabic mt-0.5 text-[0.6875rem] tracking-wide", arColor)}
            >
              نت سيل
            </span>
          )}
        </span>
      )}

      <span className="sr-only">net sale — نت سيل</span>
    </span>
  );
}
