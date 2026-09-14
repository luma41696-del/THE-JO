"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { formatDate, formatDeliveryWindow, formatPrice, t as pick } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { AdminPageHeader } from "./AdminShell";
import { ORDER_LABELS, OrderStatusPill, Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { Order, OrderStatus } from "@/types";

/**
 * Order detail — the working screen for one order.
 *
 * The status control is the point of the page, so it is the first thing under
 * the header and it offers **only the next legitimate step**, not a dropdown of
 * all nine states. A free-choice status picker is how an order ends up marked
 * delivered before it was packed, and how the customer-facing tracking timeline
 * starts lying.
 *
 * Writes go through `/api/admin/orders`, which re-verifies the caller's admin
 * claim server-side. The button being visible is not what authorises the write.
 */

/** What may legitimately follow each state. */
const NEXT: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pending: ["paid", "cancelled"],
  paid: ["processing", "cancelled"],
  processing: ["packed", "cancelled"],
  packed: ["shipped"],
  shipped: ["out-for-delivery"],
  "out-for-delivery": ["delivered"],
  delivered: ["refunded"],
};

export function OrderDetail({ order: initial }: { order: Order }) {
  const router = useLocalizedRouter();
  const [order, setOrder] = useState(initial);
  const [busy, setBusy] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(order.trackingNumber ?? "");

  const next = NEXT[order.status] ?? [];
  const currency = order.totals.currency;

  async function advance(status: OrderStatus) {
    setBusy(status);
    setError(null);

    // Optimistic: the operator sees the move immediately and it rolls back on
    // failure. Moving forty orders through a queue with a spinner on each is
    // the difference between a usable tool and an abandoned one.
    const previous = order;
    const now = Date.now();
    setOrder({
      ...order,
      status,
      updatedAt: now,
      timeline: [...order.timeline, { status, at: now }],
      trackingNumber: tracking || order.trackingNumber,
    });

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          reference: order.reference,
          status,
          trackingNumber: tracking || undefined,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; persisted?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Update failed");

      if (data.persisted === false) {
        setError(
          "Saved locally only — Firebase Admin is not configured, so this change was not written to Firestore.",
        );
      }
      router.refresh();
    } catch (caught) {
      setOrder(previous);
      setError(caught instanceof Error ? caught.message : "Could not update the order.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminPageHeader
        title={order.reference}
        description={`Placed ${formatDate(order.createdAt)} · ${order.email}`}
        actions={
          <>
            <Link href="/admin/orders">
              <Button variant="ghost" size="sm">
                ← All orders
              </Button>
            </Link>
            <Link href={`/admin/invoices/${order.reference}`}>
              <Button variant="secondary" size="sm">
                Invoice
              </Button>
            </Link>
          </>
        }
      />

      {/* The action bar — the reason this page exists. */}
      <Panel className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <OrderStatusPill status={order.status} />
            <span className="text-mist text-[0.75rem]">
              updated {formatDate(order.updatedAt)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {order.status === "packed" && (
              <input
                value={tracking}
                onChange={(event) => setTracking(event.target.value)}
                placeholder="Tracking number"
                className="border-line focus:border-violet bg-paper text-ink placeholder:text-mist w-44 rounded-pill border px-4 py-2 text-[0.8125rem] outline-none transition-colors"
              />
            )}

            {next.length === 0 ? (
              <span className="text-mist text-[0.8125rem]">No further action</span>
            ) : (
              next.map((status) => (
                <Button
                  key={status}
                  variant={status === "cancelled" ? "ghost" : "violet"}
                  size="sm"
                  loading={busy === status}
                  onClick={() => void advance(status)}
                >
                  {status === "cancelled" ? "Cancel order" : `Mark ${ORDER_LABELS[status].toLowerCase()}`}
                </Button>
              ))
            )}
          </div>
        </div>

        {error && (
          <motion.p
            role="alert"
            className="bg-coral/10 text-coral mt-4 rounded-md p-3 text-[0.8125rem]"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {error}
          </motion.p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title="Items" description={`${order.items.length} lines`}>
            <ul className="divide-line divide-y">
              {order.items.map((item) => (
                <li key={item.key} className="flex gap-4 py-3 first:pt-0 last:pb-0">
                  <span className="bg-paper-sunken relative h-20 w-15 shrink-0 overflow-hidden rounded-sm">
                    <Image src={item.image.url} alt="" fill sizes="60px" className="object-cover" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/admin/products/${item.productId}`}
                      className="text-ink block truncate text-[0.875rem] font-medium"
                    >
                      {pick(item.title, "en")}
                    </Link>
                    <span className="text-smoke mt-0.5 block text-[0.75rem]">
                      {pick(item.colorName, "en")} · {item.sizeLabel}
                    </span>
                    <span className="text-mist mt-0.5 block font-mono text-[0.6875rem]">
                      {item.sku}
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="text-ink block text-[0.875rem] font-medium tabular-nums">
                      {formatPrice(item.unitPrice * item.quantity, currency)}
                    </span>
                    <span className="text-mist block text-[0.75rem] tabular-nums">
                      {item.quantity} × {formatPrice(item.unitPrice, currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="History">
            <ol className="relative space-y-4 ps-6">
              <span className="bg-line absolute inset-y-1 start-[5px] w-px" aria-hidden="true" />
              {[...order.timeline].reverse().map((event, index) => (
                <li key={`${event.status}-${event.at}`} className="relative">
                  <span
                    className={cn(
                      "absolute -start-6 top-1.5 h-2.5 w-2.5 rounded-full",
                      index === 0 ? "bg-violet ring-violet/25 ring-4" : "bg-line-strong",
                    )}
                    aria-hidden="true"
                  />
                  <p className="text-ink text-[0.8125rem] font-medium">
                    {ORDER_LABELS[event.status]}
                  </p>
                  <p className="text-mist mt-0.5 text-[0.75rem]">
                    {formatDate(event.at)}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                  {event.note && (
                    <p className="text-smoke mt-1 text-[0.75rem]">{pick(event.note, "en")}</p>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Totals">
            <dl className="space-y-2 text-[0.8125rem]">
              <Row label="Subtotal" value={formatPrice(order.totals.subtotal, currency)} />
              {order.totals.discount > 0 && (
                <Row
                  label="Discount"
                  value={`−${formatPrice(order.totals.discount, currency)}`}
                  tone="mint"
                />
              )}
              <Row
                label="Delivery"
                value={
                  order.totals.shipping === 0
                    ? "Free"
                    : formatPrice(order.totals.shipping, currency)
                }
              />
              <Row label="Sales tax (16%)" value={formatPrice(order.totals.tax, currency)} />
              <div className="border-line flex items-baseline justify-between border-t pt-3">
                <dt className="font-display text-ink font-semibold">Total</dt>
                <dd className="font-display text-ink text-lg font-semibold tabular-nums">
                  {formatPrice(order.totals.total, currency)}
                </dd>
              </div>
            </dl>
            <p className="text-mist mt-3 text-[0.75rem] capitalize">
              Paid by {order.paymentMethod.replace("-", " ")}
            </p>
          </Panel>

          <Panel title="Delivery">
            <p className="text-ink text-[0.8125rem] leading-relaxed">
              {order.shippingAddress.fullName}
              <br />
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}
              <br />
              {order.shippingAddress.city}, {order.shippingAddress.countryCode}
            </p>
            <p className="text-smoke mt-3 text-[0.75rem]">{order.shippingAddress.phone}</p>

            <div className="border-line mt-4 border-t pt-4">
              <p className="text-ink text-[0.8125rem]">
                {pick(order.shippingMethod.name, "en")}
                <span className="text-mist ms-2">
                  {formatDeliveryWindow(
                    order.shippingMethod.minDays,
                    order.shippingMethod.maxDays,
                  )}
                </span>
              </p>
              {order.trackingNumber && (
                <p className="text-smoke mt-1.5 font-mono text-[0.75rem]">
                  {order.trackingNumber}
                </p>
              )}
            </div>
          </Panel>

          <Panel title="Customer">
            <p className="text-ink text-[0.8125rem] font-medium">
              {order.shippingAddress.fullName}
            </p>
            <p className="text-smoke mt-0.5 text-[0.75rem]">{order.email}</p>
            <Link
              href={`/admin/customers?q=${encodeURIComponent(order.email)}`}
              className="text-violet mt-3 inline-block text-[0.75rem]"
            >
              Order history →
            </Link>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "mint";
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-smoke">{label}</dt>
      <dd className={cn("tabular-nums", tone === "mint" ? "text-mint" : "text-ink")}>{value}</dd>
    </div>
  );
}
