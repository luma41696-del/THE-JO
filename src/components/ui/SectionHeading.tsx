import type { ReactNode } from "react";

import { Link } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import type { Locale } from "@/types";

export interface SectionHeadingProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: { label: string; href: string };
  align?: "start" | "center";
  className?: string;
  locale?: Locale;
}

/**
 * Section header.
 *
 * One shape for every section on the site, so the vertical rhythm of the
 * homepage stays predictable no matter how many sections are added or removed.
 *
 * Arabic headings switch to Baloo ExtraBold with neutral tracking: the Latin
 * display face reaches for presence through tight tracking and a condensed
 * geometry, neither of which Arabic has, so it gets weight instead.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  align = "start",
  className,
  locale = "en",
}: SectionHeadingProps) {
  const centered = align === "center";
  const ar = locale === "ar";

  return (
    <div
      className={cn(
        "mb-10 flex flex-col gap-5 md:mb-14 md:flex-row md:items-end md:justify-between",
        centered && "md:flex-col md:items-center md:text-center",
        className,
      )}
    >
      <div className={cn("max-w-2xl", centered && "mx-auto text-center")}>
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

        <Reveal mask distance={40}>
          <h2
            className={cn(
              "text-display text-ink text-balance",
              "font-display",
              ar && "font-extrabold tracking-normal",
            )}
          >
            {title}
          </h2>
        </Reveal>

        {description && (
          <Reveal delay={0.1}>
            <p className="text-ink-muted mt-4 text-pretty md:text-[1.0625rem]">{description}</p>
          </Reveal>
        )}
      </div>

      {action && (
        <Reveal delay={0.14} className={cn("shrink-0", centered && "mt-2")}>
          <Link
            href={action.href}
            className={cn(
              "font-ui text-ink ns-underline group inline-flex items-center gap-2 font-semibold",
              ar ? "text-[0.9375rem]" : "text-sm tracking-[0.08em] uppercase",
            )}
            data-cursor="hover"
          >
            {action.label}
            <span
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
            >
              →
            </span>
          </Link>
        </Reveal>
      )}
    </div>
  );
}
