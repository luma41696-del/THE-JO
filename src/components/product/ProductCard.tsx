"use client";

import { useState } from "react";
import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { t } from "@/lib/format";
import { useCart } from "@/lib/store/cart";
import { useUI } from "@/lib/store/ui";
import { useWishlist } from "@/lib/store/wishlist";
import { Badge } from "@/components/ui/Badge";
import { Price } from "@/components/ui/Price";
import type { Locale, Product } from "@/types";

/**
 * Product card.
 *
 * Three things a fashion card must do, in priority order:
 *  1. show the garment as large as the grid allows — the image is the product;
 *  2. make the second angle reachable without a click (hover crossfade);
 *  3. let a decided customer buy without opening the PDP (hover size rail).
 *
 * The whole card is one link. The quick-add rail and wishlist button sit above
 * it with their own handlers and stop propagation, which keeps the primary
 * target enormous while the shortcuts stay available.
 *
 * On touch, the hover rail never appears — there is no hover to reveal it —
 * so the card falls back to being a plain, very large link to the PDP.
 */

export interface ProductCardProps {
  product: Product;
  locale?: Locale;
  /** Index in the grid — drives the stagger delay only. */
  index?: number;
  priority?: boolean;
  className?: string;
  /** `hero` renders taller, for the first row of a landing grid. */
  aspect?: "portrait" | "hero";
}

export function ProductCard({
  product,
  locale = "en",
  index = 0,
  priority = false,
  className,
  aspect = "portrait",
}: ProductCardProps) {
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [activeColor, setActiveColor] = useState(product.colors[0]?.id ?? "");
  const [addedSize, setAddedSize] = useState<string | null>(null);

  const add = useCart((s) => s.add);
  const openCart = useUI((s) => s.openCart);
  const toggleWish = useWishlist((s) => s.toggle);
  const wished = useWishlist((s) => s.has(product.id));

  const title = t(product.title, locale);
  const primary = product.images.find((i) => i.colorId === activeColor) ?? product.images[0];
  const secondary = product.images[1];
  const showSecondary = hovered && !reduced && Boolean(secondary) && secondary !== primary;

  const quickSizes = product.sizes.slice(0, 6);
  const soldOut = !product.inStock;

  function quickAdd(sizeId: string) {
    const item = add({ product, colorId: activeColor, sizeId, quantity: 1 });
    if (!item) return;
    setAddedSize(sizeId);
    setTimeout(() => setAddedSize(null), 1200);
    openCart();
  }

  if (!primary) return null;

  return (
    <motion.article
      className={cn("group relative", className)}
      initial={reduced ? undefined : { opacity: 0, y: 20 }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8%" }}
      transition={{ duration: 0.5, ease: EASE.jo, delay: Math.min(index * 0.05, 0.3) }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
    >
      <div
        className={cn(
          "rounded-lg bg-paper-sunken relative overflow-hidden",
          aspect === "hero" ? "aspect-[3/4.4]" : "aspect-[3/4]",
        )}
      >
        <Link
          href={`/product/${product.slug}`}
          className="absolute inset-0 z-10"
          data-cursor="view"
          data-cursor-label={locale === "ar" ? "عرض" : "View"}
        >
          <span className="sr-only">{title}</span>
        </Link>

        {/* Base image. Scales gently on hover — the frame stays put. */}
        <motion.div
          className="absolute inset-0"
          animate={{ scale: hovered && !reduced ? 1.05 : 1 }}
          transition={{ duration: 0.7, ease: EASE.jo }}
        >
          <Image
            src={primary.url}
            alt={primary.alt}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover"
            priority={priority}
            placeholder={primary.blurDataURL ? "blur" : "empty"}
            blurDataURL={primary.blurDataURL}
          />
        </motion.div>

        {/* Second angle, crossfaded in. */}
        <AnimatePresence>
          {showSecondary && secondary && (
            <motion.div
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1.02 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: EASE.jo }}
            >
              <Image
                src={secondary.url}
                alt={secondary.alt}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className="object-cover"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Badges */}
        {product.badges.length > 0 && (
          <div className="pointer-events-none absolute start-3 top-3 z-20 flex flex-col items-start gap-1.5">
            {product.badges.slice(0, 2).map((badge) => (
              <Badge key={badge} badge={badge} locale={locale} />
            ))}
          </div>
        )}

        {/* Wishlist */}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            toggleWish(product.id);
          }}
          aria-pressed={wished}
          aria-label={
            wished
              ? locale === "ar"
                ? "إزالة من المفضلة"
                : "Remove from wishlist"
              : locale === "ar"
                ? "إضافة إلى المفضلة"
                : "Add to wishlist"
          }
          className={cn(
            "jo-glass absolute end-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full",
            "cursor-pointer transition-all duration-300",
            "md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
            wished && "md:opacity-100",
          )}
          data-cursor="hover"
        >
          <Heart filled={wished} />
        </button>

        {/* Quick-add rail. Pointer-fine only; it is not a touch affordance. */}
        <AnimatePresence>
          {hovered && !reduced && !soldOut && (
            <motion.div
              className="absolute inset-x-3 bottom-3 z-20 hidden md:block"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={transition.base}
            >
              <div className="jo-glass rounded-md shadow-float flex items-center gap-1 p-1.5">
                <span className="text-mist ps-2 pe-1 text-[0.625rem] tracking-[0.14em] uppercase">
                  {locale === "ar" ? "أضف" : "Add"}
                </span>
                <div className="flex flex-1 items-center justify-end gap-1">
                  {quickSizes.map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        quickAdd(size.id);
                      }}
                      className={cn(
                        "h-7 min-w-7 cursor-pointer rounded-xs px-1.5 text-[0.6875rem] font-medium",
                        "transition-all duration-200",
                        addedSize === size.id
                          ? "bg-mint text-white"
                          : "text-ink-muted hover:bg-ink hover:text-white",
                      )}
                      data-cursor="hover"
                      aria-label={`${locale === "ar" ? "أضف مقاس" : "Add size"} ${size.label}`}
                    >
                      {addedSize === size.id ? "✓" : size.label}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {soldOut && (
          <div className="bg-paper/70 absolute inset-0 z-20 grid place-items-center backdrop-blur-[2px]">
            <span className="font-display text-eyebrow text-ink bg-paper-raised rounded-pill px-4 py-2 uppercase">
              {locale === "ar" ? "نفدت الكمية" : "Sold out"}
            </span>
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-ink truncate text-[0.9375rem] font-medium">
            <Link href={`/product/${product.slug}`} className="jo-underline">
              {title}
            </Link>
          </h3>
          {product.subtitle && (
            <p className="text-smoke mt-0.5 truncate text-[0.8125rem]">
              {t(product.subtitle, locale)}
            </p>
          )}
          <Price
            value={product.price}
            compareAt={product.compareAtPrice}
            currency={product.currency}
            locale={locale}
            className="mt-2"
          />
        </div>

        {product.colors.length > 1 && (
          <div className="flex shrink-0 items-center gap-1.5 pt-1">
            {product.colors.slice(0, 4).map((color) => (
              <button
                key={color.id}
                type="button"
                onClick={() => setActiveColor(color.id)}
                aria-label={t(color.name, locale)}
                aria-pressed={activeColor === color.id}
                title={t(color.name, locale)}
                className={cn(
                  "h-3.5 w-3.5 cursor-pointer rounded-full transition-all duration-200",
                  "ring-1 ring-ink/12 ring-offset-2 ring-offset-paper",
                  activeColor === color.id && "ring-ink ring-[1.5px]",
                )}
                style={{
                  background: color.hexSecondary
                    ? `linear-gradient(135deg, ${color.hex} 50%, ${color.hexSecondary} 50%)`
                    : color.hex,
                }}
                data-cursor="hover"
              />
            ))}
            {product.colors.length > 4 && (
              <span className="text-mist text-[0.6875rem]">+{product.colors.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </motion.article>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 13.8s-5.4-3.4-5.4-7A3.1 3.1 0 0 1 8 5.2a3.1 3.1 0 0 1 5.4 1.6c0 3.6-5.4 7-5.4 7Z"
        fill={filled ? "var(--color-violet)" : "none"}
        stroke={filled ? "var(--color-violet)" : "currentColor"}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}
