import { ProductGridSkeleton } from "@/components/product/ProductGrid";

/**
 * Storefront loading state.
 *
 * Deliberately a layout skeleton rather than a spinner: it reserves the same
 * space the real content will occupy, so nothing jumps when the data arrives.
 * A centred spinner tells the customer to wait; this tells them what is coming.
 */
export default function Loading() {
  return (
    <div className="ns-container pt-32 pb-20 md:pt-44">
      <div className="ns-shimmer h-4 w-28 rounded-xs" />
      <div className="ns-shimmer mt-5 h-12 w-2/3 max-w-xl rounded-sm" />
      <div className="ns-shimmer mt-4 h-4 w-1/2 max-w-md rounded-xs" />

      <div className="mt-14">
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
