import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import type { Locale } from "@/types";

export interface PageIntroProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  align?: "start" | "center";
  locale?: Locale;
}

/**
 * Standard page header.
 *
 * Owns the top padding that clears the fixed navbar, so no page has to
 * remember the header's height. Change the bar and this is the only place that
 * needs updating.
 */
export function PageIntro({
  eyebrow,
  title,
  description,
  children,
  className,
  align = "start",
  locale = "en",
}: PageIntroProps) {
  const ar = locale === "ar";

  return (
    <header
      className={cn(
        "ns-container pt-32 pb-10 md:pt-44 md:pb-14",
        align === "center" && "text-center",
        className,
      )}
    >
      <div className={cn("max-w-3xl", align === "center" && "mx-auto")}>
        {eyebrow && (
          <Reveal>
            <p
              className={cn(
                "font-ui text-brand mb-4",
                ar ? "text-[0.8125rem] font-semibold" : "text-eyebrow uppercase",
              )}
            >
              {eyebrow}
            </p>
          </Reveal>
        )}

        <Reveal mask distance={48}>
          <h1
            className={cn(
              "text-display text-ink text-balance",
              ar ? "font-arabic font-extrabold tracking-normal" : "font-display",
            )}
          >
            {title}
          </h1>
        </Reveal>

        {description && (
          <Reveal delay={0.1}>
            <p className="text-ink-muted mt-4 text-pretty md:text-[1.0625rem]">{description}</p>
          </Reveal>
        )}
      </div>

      {children}
    </header>
  );
}
