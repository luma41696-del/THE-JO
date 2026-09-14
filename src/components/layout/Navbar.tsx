"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";

import { Link } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { useCart, useCartHydrated } from "@/lib/store/cart";
import { useUI } from "@/lib/store/ui";
import { useWishlist } from "@/lib/store/wishlist";
import { useAuth } from "@/components/providers/AuthProvider";
import { useI18n } from "@/components/providers/LocaleProvider";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";
import { LanguageSwitcher, LanguageSwitcherWide } from "./LanguageSwitcher";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * Primary navigation.
 *
 * A floating glass bar rather than a full-width band: it keeps the product
 * imagery edge-to-edge underneath, which is what makes a fashion homepage feel
 * like a magazine instead of an admin panel.
 *
 * Scroll behaviour: the bar compacts after 40px, then hides on downward scroll
 * past 280px and returns immediately on any upward scroll. Hiding while
 * scrolling *down* is safe — the customer is reading. Returning on *up* is
 * essential — that gesture usually means "take me back".
 *
 * The whole bar is direction-agnostic: it uses logical properties throughout,
 * so RTL is handled by the `dir` attribute rather than a mirrored stylesheet.
 */

const NAV = (t: Dictionary) => [
  { href: "/shop", label: t.nav.shop },
  { href: "/categories", label: t.nav.categories },
  { href: "/shop?sort=newest", label: t.nav.newIn },
  { href: "/fitting-room", label: t.nav.fittingRoom },
];

export function Navbar({ announcement }: { announcement?: React.ReactNode }) {
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const { scrollY } = useScroll();
  const [compact, setCompact] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [lastY, setLastY] = useState(0);

  const openCart = useUI((s) => s.openCart);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const mobileNavOpen = useUI((s) => s.mobileNavOpen);
  const setSearchOpen = useUI((s) => s.setSearchOpen);

  const hydrated = useCartHydrated();
  const cartCount = useCart((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
  const addedTick = useCart((s) => s.addedTick);
  const wishCount = useWishlist((s) => s.ids.length);
  const { status, profile } = useAuth();

  const items = NAV(t);

  useMotionValueEvent(scrollY, "change", (y) => {
    setCompact(y > 40);
    setHidden(y > 280 && y > lastY);
    setLastY(y);
  });

  // Any navigation closes every overlay — a drawer surviving a route change is
  // the single most common navigation bug in commerce SPAs.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  return (
    <>
      <motion.header
        className="fixed inset-x-0 top-0 z-[120]"
        animate={{ y: hidden ? "-140%" : 0 }}
        transition={{ duration: 0.42, ease: EASE.jo }}
      >
        {announcement}

        {/* The pill is inset from the viewport edge; the announcement above it
            stays full-bleed. */}
        <div className="px-3 pt-3 md:px-6 md:pt-4">
          <motion.nav
            className={cn(
              "jo-container flex items-center justify-between gap-4",
              "rounded-pill transition-all duration-500",
              compact ? "jo-glass shadow-float" : "bg-transparent",
            )}
            animate={{ paddingTop: compact ? 10 : 14, paddingBottom: compact ? 10 : 14 }}
            transition={transition.base}
          >
            {/* Brand */}
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2.5"
              aria-label={`${t.brand.name} — ${t.nav.home}`}
              data-cursor="hover"
            >
              <AnimatedLogo className="h-9 w-9" intro={false} title={null} />
              <span
                className={cn(
                  "text-ink hidden text-[0.9375rem] font-semibold sm:block",
                  // The Latin wordmark is the logo face; the Arabic is Baloo,
                  // which needs no tracking because it is already open.
                  locale === "ar"
                    ? "font-arabic text-[1.0625rem]"
                    : "font-display tracking-[0.16em] uppercase",
                )}
              >
                {locale === "ar" ? "ذاجو" : "The Jo"}
              </span>
            </Link>

            {/* Desktop links */}
            <ul className="hidden items-center gap-8 lg:flex">
              {items.map((item) => {
                const base = item.href.split("?")[0] ?? "";
                const active = pathname.endsWith(base);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "font-ui jo-underline relative text-[0.8125rem] font-semibold transition-colors",
                        locale === "ar" ? "text-[0.9375rem]" : "tracking-[0.1em] uppercase",
                        active ? "text-ink" : "text-ink-muted hover:text-ink",
                      )}
                      data-cursor="hover"
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1">
              <LanguageSwitcher />

              <IconButton label={t.nav.search} onClick={() => setSearchOpen(true)}>
                <SearchIcon />
              </IconButton>

              <IconButton
                as="link"
                href="/wishlist"
                label={t.nav.wishlist}
                badge={hydrated ? wishCount : 0}
                className="hidden sm:inline-flex"
              >
                <HeartIcon />
              </IconButton>

              <IconButton
                as="link"
                href={status === "authenticated" ? "/account" : "/login"}
                label={
                  status === "authenticated"
                    ? profile?.displayName || t.nav.account
                    : t.nav.signIn
                }
                className="hidden sm:inline-flex"
              >
                <UserIcon />
              </IconButton>

              {/* Cart — the badge pops on every add, which is the confirmation
                  that the item landed somewhere real. */}
              <IconButton
                label={t.nav.bag}
                onClick={openCart}
                badge={hydrated ? cartCount : 0}
                badgeKey={addedTick}
                emphasis
              >
                <BagIcon />
              </IconButton>

              <button
                type="button"
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
                aria-label={t.nav.menu}
                aria-expanded={mobileNavOpen}
                className="text-ink ms-1 grid h-10 w-10 cursor-pointer place-items-center lg:hidden"
                data-cursor="hover"
              >
                <MenuIcon open={mobileNavOpen} />
              </button>
            </div>
          </motion.nav>
        </div>
      </motion.header>

      <MobileNav />
    </>
  );
}

/* -------------------------------------------------------------------------- */

interface IconButtonProps {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  /** `link` renders an anchor; anything else renders a button. */
  as?: "link" | "button";
  badge?: number;
  /** Re-key the badge so it replays its pop animation. */
  badgeKey?: number;
  emphasis?: boolean;
  className?: string;
}

function IconButton({
  children,
  label,
  onClick,
  href,
  as = "button",
  badge = 0,
  badgeKey,
  emphasis = false,
  className,
}: IconButtonProps) {
  const content = (
    <>
      {children}
      <AnimatePresence mode="popLayout">
        {badge > 0 && (
          <motion.span
            key={badgeKey ?? badge}
            className={cn(
              "absolute -end-0.5 -top-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full px-1",
              "text-[0.625rem] font-semibold tabular-nums",
              emphasis ? "bg-violet text-white" : "bg-ink text-white",
            )}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.35, 1], opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.42, ease: EASE.spring }}
          >
            {badge > 99 ? "99+" : badge}
          </motion.span>
        )}
      </AnimatePresence>
      <span className="sr-only">{label}</span>
    </>
  );

  const classes = cn(
    "relative grid h-10 w-10 cursor-pointer place-items-center rounded-full",
    "text-ink transition-colors duration-300 hover:bg-ink/6",
    className,
  );

  if (as === "link" && href) {
    return (
      <Link href={href} className={classes} aria-label={label} data-cursor="hover">
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes} aria-label={label} data-cursor="hover">
      {content}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function MobileNav() {
  const open = useUI((s) => s.mobileNavOpen);
  const setOpen = useUI((s) => s.setMobileNavOpen);
  const { status } = useAuth();
  const { t, locale } = useI18n();

  const items = NAV(t);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[110] lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <button
            type="button"
            className="bg-ink/25 absolute inset-0 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-label={t.common.close}
          />

          <motion.div
            className="bg-paper absolute inset-x-0 top-0 rounded-b-2xl px-6 pt-26 pb-10 shadow-hover"
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={transition.drawer}
          >
            <ul className="flex flex-col gap-1">
              {items.map((item, index) => (
                <motion.li
                  key={item.href}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 + index * 0.05, duration: 0.4, ease: EASE.jo }}
                >
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "text-ink block py-3 text-2xl font-semibold tracking-tight",
                      locale === "ar" ? "font-arabic" : "font-display",
                    )}
                  >
                    {item.label}
                  </Link>
                </motion.li>
              ))}
            </ul>

            <div className="border-line mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-6">
              <Link href="/wishlist" onClick={() => setOpen(false)} className="text-ink-muted text-sm">
                {t.nav.wishlist}
              </Link>
              <Link
                href={status === "authenticated" ? "/account" : "/login"}
                onClick={() => setOpen(false)}
                className="text-ink-muted text-sm"
              >
                {status === "authenticated" ? t.nav.account : t.nav.signIn}
              </Link>
              <Link href="/orders" onClick={() => setOpen(false)} className="text-ink-muted text-sm">
                {t.nav.orders}
              </Link>
            </div>

            <div className="mt-5">
              <LanguageSwitcherWide onSwitch={() => setOpen(false)} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* --- icons: 1.5px stroke, 20px box, inherit currentColor ----------------- */

function SearchIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 16.5s-6.5-4-6.5-8.3A3.7 3.7 0 0 1 10 6.2a3.7 3.7 0 0 1 6.5 2c0 4.3-6.5 8.3-6.5 8.3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 17c0-2.8 2.7-4.6 6-4.6s6 1.8 6 4.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.6 6.5h10.8l.9 10.2a1 1 0 0 1-1 1.1H4.7a1 1 0 0 1-1-1.1L4.6 6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.2 8.4V5.6a2.8 2.8 0 0 1 5.6 0v2.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Closed-state geometry, shared by the literal attribute and `initial`. */
const BURGER_TOP = "M3 7 L17 7";
const BURGER_BOTTOM = "M3 13 L17 13";

/**
 * Burger that morphs into a close cross.
 *
 * Each path needs its start value in **two** places, and both matter:
 *
 *  - the literal `d` attribute is what the server renders and what a
 *    JS-disabled browser shows;
 *  - `initial` is what Motion interpolates *from*. Without it Motion reads the
 *    starting value off the DOM, and for `d` that read comes back undefined
 *    even though the attribute is set — so the first frame writes the string
 *    "undefined" into `d` and the browser drops the path.
 */
function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <motion.path
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        d={BURGER_TOP}
        initial={{ d: BURGER_TOP }}
        animate={{ d: open ? "M5 5 L15 15" : BURGER_TOP }}
        transition={{ duration: 0.3, ease: EASE.jo }}
      />
      <motion.path
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        d={BURGER_BOTTOM}
        initial={{ d: BURGER_BOTTOM }}
        animate={{ d: open ? "M15 5 L5 15" : BURGER_BOTTOM }}
        transition={{ duration: 0.3, ease: EASE.jo }}
      />
    </svg>
  );
}
