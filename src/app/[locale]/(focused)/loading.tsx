/**
 * Checkout, login and register — the loading state.
 *
 * The storefront had a skeleton; this group had nothing. Checkout is the most
 * latency-sensitive page in the shop: it waits on products, offers, shipping
 * methods, shipping classes and zones before it can render a total. Without a
 * loading state the customer taps "Checkout" and keeps looking at the bag
 * until the swap happens — the exact "did my tap work?" moment, at the point
 * in the journey where a second tap or a back-press costs the most.
 *
 * A skeleton rather than a spinner, matching the storefront: it reserves the
 * shape that is coming, so nothing jumps when the data lands.
 */
export default function Loading() {
  return (
    <div className="ns-container py-16 md:py-24">
      {/* Step rail */}
      <div className="mx-auto flex max-w-md items-center justify-between gap-3">
        {[0, 1, 2].map((step) => (
          <div key={step} className="flex flex-1 items-center gap-2">
            <div className="ns-shimmer h-7 w-7 shrink-0 rounded-full" />
            <div className="ns-shimmer h-3 flex-1 rounded-xs" />
          </div>
        ))}
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* The form */}
        <div className="flex flex-col gap-4">
          <div className="ns-shimmer h-7 w-56 rounded-sm" />
          <div className="ns-shimmer h-11 w-full rounded-md" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="ns-shimmer h-11 rounded-md" />
            <div className="ns-shimmer h-11 rounded-md" />
          </div>
          <div className="ns-shimmer h-11 w-full rounded-md" />
          <div className="ns-shimmer h-11 w-full rounded-md" />
          <div className="ns-shimmer mt-2 h-12 w-40 rounded-pill" />
        </div>

        {/* The summary */}
        <div className="bg-paper-raised border-line rounded-xl border p-5">
          <div className="ns-shimmer h-4 w-24 rounded-xs" />
          <div className="mt-5 flex flex-col gap-4">
            {[0, 1].map((line) => (
              <div key={line} className="flex gap-3">
                <div className="ns-shimmer h-20 w-15 shrink-0 rounded-sm" />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <div className="ns-shimmer h-3 w-3/4 rounded-xs" />
                  <div className="ns-shimmer h-3 w-1/2 rounded-xs" />
                </div>
              </div>
            ))}
          </div>
          <div className="border-line mt-5 flex flex-col gap-3 border-t pt-5">
            <div className="ns-shimmer h-3 w-full rounded-xs" />
            <div className="ns-shimmer h-3 w-full rounded-xs" />
            <div className="ns-shimmer h-5 w-2/3 rounded-xs" />
          </div>
        </div>
      </div>
    </div>
  );
}
