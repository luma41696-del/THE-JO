import { cn } from "@/lib/utils";
import type { Locale, Product } from "@/types";
import { ProductCard } from "./ProductCard";

export interface ProductGridProps {
  products: Product[];
  locale?: Locale;
  className?: string;
  /** Columns at the widest breakpoint. Below that the grid steps down. */
  columns?: 2 | 3 | 4;
  /** Mark the first row as LCP candidates. Use on the first grid of a page. */
  priorityCount?: number;
  emptyState?: React.ReactNode;
}

const COLUMNS = {
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
} as const;

export function ProductGrid({
  products,
  locale = "en",
  className,
  columns = 4,
  priorityCount = 0,
  emptyState,
}: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="border-line rounded-xl border border-dashed py-20 text-center">
        {emptyState ?? (
          <p className="text-smoke">
            {locale === "ar" ? "لا توجد منتجات مطابقة." : "Nothing matches those filters yet."}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-x-4 gap-y-10 md:gap-x-6 md:gap-y-14", COLUMNS[columns], className)}>
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          locale={locale}
          index={index}
          priority={index < priorityCount}
        />
      ))}
    </div>
  );
}

/** Matching skeleton, so a suspended grid reserves the same space. */
export function ProductGridSkeleton({
  count = 8,
  columns = 4,
}: {
  count?: number;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div className={cn("grid gap-x-4 gap-y-10 md:gap-x-6 md:gap-y-14", COLUMNS[columns])}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index}>
          <div className="ns-shimmer rounded-lg aspect-[3/4]" />
          <div className="ns-shimmer mt-4 h-4 w-3/4 rounded-xs" />
          <div className="ns-shimmer mt-2 h-3 w-1/2 rounded-xs" />
          <div className="ns-shimmer mt-3 h-4 w-1/4 rounded-xs" />
        </div>
      ))}
    </div>
  );
}
