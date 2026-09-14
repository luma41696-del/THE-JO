"use client";

import { useEffect, useState } from "react";
import { Link } from "@/components/ui/Link";

import { useWishlist } from "@/lib/store/wishlist";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductGrid";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";
import type { Locale, Product } from "@/types";

/**
 * Wishlist contents.
 *
 * Reads ids from the persisted store and resolves them against the catalogue
 * passed in from the server. The `mounted` gate matters: `localStorage` is not
 * available during SSR, so rendering the real list on the first client pass
 * would be a hydration mismatch. The skeleton is what the server renders.
 */
export function WishlistClient({
  products,
  locale = "en",
}: {
  products: Product[];
  locale?: Locale;
}) {
  const ids = useWishlist((s) => s.ids);
  const clear = useWishlist((s) => s.clear);
  const [mounted, setMounted] = useState(false);
  const rtl = locale === "ar";

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="ns-container pb-20">
        <ProductGridSkeleton count={4} />
      </div>
    );
  }

  const saved = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));

  if (saved.length === 0) {
    return (
      <div className="ns-container pb-24">
        <div className="border-line rounded-xl flex flex-col items-center border border-dashed py-20 text-center">
          <div className="h-28 w-28 opacity-70">
            <BrandWave rings={3} color="var(--color-brand)" speed={8} />
          </div>
          <h2 className="font-display text-ink mt-6 text-xl font-semibold">
            {rtl ? "لا توجد قطع محفوظة" : "Nothing saved yet"}
          </h2>
          <p className="text-smoke mt-2 max-w-sm text-[0.9375rem]">
            {rtl
              ? "اضغط على القلب في أي قطعة لحفظها هنا والعودة إليها لاحقاً."
              : "Tap the heart on any piece to keep it here and come back to it later."}
          </p>
          <Link href="/shop" className="mt-7">
            <Button variant="primary" size="lg" magnetic>
              {rtl ? "تصفّح المجموعة" : "Browse the collection"}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ns-container pb-24">
      <div className="border-line mb-10 flex items-center justify-between border-b pb-4">
        <p className="text-smoke text-[0.875rem] tabular-nums">
          {saved.length} {rtl ? "قطعة محفوظة" : saved.length === 1 ? "piece saved" : "pieces saved"}
        </p>
        <button
          type="button"
          onClick={clear}
          className="text-smoke hover:text-alert cursor-pointer text-[0.8125rem] underline-offset-4 transition-colors hover:underline"
          data-cursor="hover"
        >
          {rtl ? "مسح الكل" : "Clear all"}
        </button>
      </div>

      <ProductGrid products={saved} locale={locale} columns={4} priorityCount={4} />
    </div>
  );
}
