import { Link } from "@/components/ui/Link";

import { cn } from "@/lib/utils";
import { alertedProductCount, type StockAlert } from "@/lib/stock";
import { Panel } from "./AdminUI";

/**
 * Low stock, per variant.
 *
 * The dashboard already carries a "total stock" figure, and that figure is
 * exactly what hides this: a coat with 40 units can be entirely large and
 * extra-large while every middle size is gone. This panel exists to name the
 * rows a buyer has to reorder, so the answer is a SKU rather than a hunch.
 *
 * Sold out sits above low, and both are stated plainly — no colour-only
 * signal, because the difference between "none left" and "two left" changes
 * what a buyer does next.
 */
export function LowStockPanel({
  alerts,
  threshold,
}: {
  alerts: StockAlert[];
  threshold: number;
}) {
  const products = alertedProductCount(alerts);

  return (
    <Panel
      title="Stock needing attention"
      description={
        alerts.length === 0
          ? `Nothing at or below ${threshold} units.`
          : `${alerts.length} variant${alerts.length === 1 ? "" : "s"} across ${products} product${
              products === 1 ? "" : "s"
            }, at or below ${threshold} units.`
      }
    >
      {alerts.length === 0 ? (
        <p className="text-mist text-[0.8125rem]">
          Every active variant is above the threshold. Change it under Settings
          → Delivery and returns.
        </p>
      ) : (
        <ul className="divide-line divide-y">
          {alerts.map((alert) => (
            <li key={alert.sku} className="flex items-center gap-3 py-2.5">
              <span
                className={cn(
                  "rounded-xs w-16 shrink-0 px-2 py-1 text-center text-[0.6875rem] font-semibold tracking-[0.06em] uppercase",
                  alert.state === "out"
                    ? "bg-alert/12 text-alert"
                    : "bg-sand text-ink",
                )}
              >
                {alert.state === "out" ? "None" : alert.stock}
              </span>

              <span className="min-w-0 flex-1">
                <Link
                  href={`/admin/products/${alert.productId}`}
                  className="text-ink block truncate text-[0.8125rem] font-medium"
                >
                  {alert.title.en}
                </Link>
                <span className="text-smoke block truncate text-[0.75rem]">
                  {[alert.designName, alert.colorName, alert.sizeLabel]
                    .filter(Boolean)
                    .join(" · ") || "Single item"}
                </span>
              </span>

              {/* The SKU is what gets typed into a purchase order. */}
              <span className="text-mist shrink-0 font-mono text-[0.6875rem]">{alert.sku}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
