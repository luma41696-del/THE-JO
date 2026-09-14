"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { Sparkline } from "./charts/Charts";
import type { InvoiceStatus, OrderStatus, TicketPriority, TicketStatus } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Surfaces                                                                  */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cn("bg-paper-raised border-line rounded-lg border", className)}>
      {(title || actions) && (
        <header className="border-line flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            {title && <h2 className="font-display text-ink text-[0.9375rem] font-semibold">{title}</h2>}
            {description && <p className="text-mist mt-0.5 text-[0.75rem]">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat tile                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A headline figure with its own trend.
 *
 * The delta is always labelled with the comparison window. A bare "+12%" is
 * unreadable — twelve percent against what? Every tile here says "vs previous
 * 30 days" so the number can actually be acted on.
 */
export function StatTile({
  label,
  value,
  change,
  changeLabel,
  spark,
  invertChange = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  spark?: number[];
  /** For metrics where down is good — refunds, response time. */
  invertChange?: boolean;
  emphasis?: boolean;
}) {
  const tone =
    change === undefined || Math.abs(change) < 0.005
      ? "flat"
      : (invertChange ? change < 0 : change > 0)
        ? "up"
        : "down";

  return (
    <div
      className={cn(
        "border-line rounded-lg border p-5",
        emphasis ? "bg-ink text-white" : "bg-paper-raised",
      )}
    >
      <p
        className={cn(
          "text-[0.6875rem] font-medium tracking-[0.12em] uppercase",
          emphasis ? "text-white/50" : "text-mist",
        )}
      >
        {label}
      </p>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <motion.p
          className={cn(
            "font-display text-2xl font-semibold tabular-nums",
            emphasis ? "text-white" : "text-ink",
          )}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE.brand }}
        >
          {value}
        </motion.p>
        {spark && spark.length > 1 && (
          <div className="shrink-0 opacity-90">
            <Sparkline values={spark} tone={emphasis ? "mint" : "brand"} />
          </div>
        )}
      </div>

      {change !== undefined && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.75rem]">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium tabular-nums",
              tone === "up" && "text-mint",
              tone === "down" && "text-alert",
              tone === "flat" && (emphasis ? "text-white/60" : "text-mist"),
            )}
          >
            {tone !== "flat" && (
              <span aria-hidden="true">{change > 0 ? "↑" : "↓"}</span>
            )}
            {Math.abs(Math.round(change * 100))}%
          </span>
          <span className={emphasis ? "text-white/45" : "text-mist"}>{changeLabel}</span>
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status pills                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Status is encoded in **shape and text**, not colour alone.
 *
 * Each pill carries its label, so a colour-blind reader or a greyscale print
 * loses nothing. Semantic colours are reserved: brand is in progress, mint is
 * done, alert is a problem. They are never borrowed for a chart series.
 */
const ORDER_TONES: Record<OrderStatus, string> = {
  pending: "bg-paper-sunken text-smoke",
  paid: "bg-brand-mist text-brand-deep",
  processing: "bg-brand-mist text-brand-deep",
  packed: "bg-brand-mist text-brand-deep",
  shipped: "bg-brand/12 text-brand-deep",
  "out-for-delivery": "bg-brand/12 text-brand-deep",
  delivered: "bg-mint/12 text-mint",
  cancelled: "bg-alert/12 text-alert",
  refunded: "bg-sand text-ink-muted",
};

const ORDER_LABELS: Record<OrderStatus, string> = {
  pending: "Awaiting payment",
  paid: "Paid",
  processing: "Processing",
  packed: "Packed",
  shipped: "Shipped",
  "out-for-delivery": "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export function OrderStatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2.5 py-1 text-[0.6875rem] font-medium whitespace-nowrap",
        ORDER_TONES[status],
        className,
      )}
    >
      {ORDER_LABELS[status]}
    </span>
  );
}

export { ORDER_LABELS };

const TICKET_TONES: Record<TicketStatus, string> = {
  open: "bg-alert/12 text-alert",
  pending: "bg-brand-mist text-brand-deep",
  resolved: "bg-mint/12 text-mint",
  closed: "bg-paper-sunken text-smoke",
};

export function TicketStatusPill({ status }: { status: TicketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2.5 py-1 text-[0.6875rem] font-medium capitalize",
        TICKET_TONES[status],
      )}
    >
      {status}
    </span>
  );
}

const PRIORITY_TONES: Record<TicketPriority, string> = {
  low: "text-mist",
  normal: "text-smoke",
  high: "text-brand-deep",
  urgent: "text-alert",
};

export function PriorityFlag({ priority }: { priority: TicketPriority }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[0.75rem] capitalize", PRIORITY_TONES[priority])}>
      {(priority === "urgent" || priority === "high") && <span aria-hidden="true">▲</span>}
      {priority}
    </span>
  );
}

const INVOICE_TONES: Record<InvoiceStatus, string> = {
  draft: "bg-paper-sunken text-smoke",
  issued: "bg-brand-mist text-brand-deep",
  paid: "bg-mint/12 text-mint",
  credited: "bg-sand text-ink-muted",
};

export function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2.5 py-1 text-[0.6875rem] font-medium capitalize",
        INVOICE_TONES[status],
      )}
    >
      {status}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Data table                                                                */
/* -------------------------------------------------------------------------- */

export interface Column<T> {
  key: string;
  header: string;
  /** Rendered cell. */
  cell: (row: T) => ReactNode;
  /** Value used for sorting and for exports — keep it primitive. */
  sortValue?: (row: T) => string | number;
  align?: "start" | "end";
  className?: string;
}

/**
 * Sortable table.
 *
 * Sorting is client-side and deliberate: these screens cap at a thousand rows,
 * and a round trip to re-sort a table the operator is looking at is a worse
 * experience than the memory cost. Past that, this moves to a server query.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty = "Nothing here yet.",
  initialSort,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const [sort, setSort] = useState(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;

    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, columns, sort]);

  function toggle(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }

  if (rows.length === 0) {
    return (
      <div className="border-line text-smoke rounded-lg border border-dashed py-16 text-center text-[0.9375rem]">
        {empty}
      </div>
    );
  }

  return (
    <div className="border-line rounded-lg overflow-x-auto border">
      <table className="w-full text-[0.8125rem]">
        <thead className="bg-paper-sunken">
          <tr>
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue);
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn(
                    "text-mist px-4 py-3 text-[0.625rem] font-medium tracking-[0.12em] whitespace-nowrap uppercase",
                    column.align === "end" ? "text-end" : "text-start",
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={cn(
                        "hover:text-ink inline-flex cursor-pointer items-center gap-1 transition-colors",
                        active && "text-ink",
                      )}
                      data-cursor="hover"
                    >
                      {column.header}
                      <span aria-hidden="true" className={cn("text-[0.625rem]", !active && "opacity-30")}>
                        {active && sort!.dir === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "transition-colors",
                onRowClick && "hover:bg-paper-sunken/60 cursor-pointer",
              )}
              data-cursor={onRowClick ? "hover" : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-4 py-3 align-middle",
                    column.align === "end" ? "text-end" : "text-start",
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Filter chips                                                              */
/* -------------------------------------------------------------------------- */

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  counts,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "rounded-pill inline-flex cursor-pointer items-center gap-1.5 border px-3 py-1.5 text-[0.75rem] transition-all",
              active
                ? "border-ink bg-ink text-white"
                : "border-line text-ink-muted hover:border-ink/40 bg-paper-raised",
            )}
            data-cursor="hover"
          >
            {option.label}
            {counts?.[option.value] !== undefined && (
              <span className={cn("tabular-nums", active ? "text-white/60" : "text-mist")}>
                {counts[option.value]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
