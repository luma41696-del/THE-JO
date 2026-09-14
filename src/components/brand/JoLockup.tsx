import { cn } from "@/lib/utils";
import { JoMark, type MarkTone } from "./JoMark";

export interface JoLockupProps {
  tone?: MarkTone;
  /** `full` shows the bilingual wordmark, `compact` shows Latin only. */
  variant?: "full" | "compact" | "mark";
  className?: string;
  markClassName?: string;
}

/**
 * The horizontal lockup: mark, Latin wordmark, Arabic wordmark.
 *
 * The Arabic sits *under* the Latin at a smaller optical size rather than
 * beside it — Arabic letterforms carry more visual weight per character, so
 * setting the two at the same size makes the Latin look starved.
 */
export function JoLockup({
  tone = "ink",
  variant = "full",
  className,
  markClassName,
}: JoLockupProps) {
  const wordColor = tone === "light" ? "text-white" : "text-ink";
  const arColor = tone === "light" ? "text-violet-bright" : "text-violet";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <JoMark tone={tone} className={cn("h-9 w-9 shrink-0", markClassName)} title={null} />

      {variant !== "mark" && (
        <span className="flex flex-col leading-none">
          <span
            className={cn(
              "font-display text-[1.0625rem] font-semibold tracking-[0.14em] uppercase",
              wordColor,
            )}
          >
            The Jo
          </span>
          {variant === "full" && (
            <span
              lang="ar"
              dir="rtl"
              className={cn("font-arabic mt-0.5 text-[0.6875rem] tracking-wide", arColor)}
            >
              ذاجو
            </span>
          )}
        </span>
      )}

      <span className="sr-only">THE JO — ذاجو</span>
    </span>
  );
}
