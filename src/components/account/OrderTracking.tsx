"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { formatDate, formatDeliveryWindow, formatPrice, t } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  FULFILMENT_STEPS,
  STATUS_LABELS,
  fetchOrderByReference,
  fulfilmentProgress,
} from "@/lib/firebase/orders";
import { StatusChip } from "./AccountPanel";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";
import type { Locale, Order } from "@/types";
import { lineOptions } from "@/lib/product";

/**
 * Order tracking.
 *
 * The progress rail is the page. It answers "where is my parcel" in one glance
 * and in the customer's own vocabulary — "Packed", "Out for delivery" — rather
 * than carrier status codes.
 *
 * Cancelled and refunded orders skip the rail entirely: showing a half-filled
 * progress bar on an order that is never arriving is worse than showing none.
 */
export function OrderTracking({
  reference,
  locale = "en",
}: {
  reference: string;
  locale?: Locale;
}) {
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null | "missing">(null);
  const rtl = locale === "ar";

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void fetchOrderByReference(user.uid, reference)
      .then((row) => !cancelled && setOrder(row ?? "missing"))
      .catch(() => !cancelled && setOrder("missing"));

    return () => {
      cancelled = true;
    };
  }, [user, reference]);

  if (order === null) {
    return (
      <div className="ns-container pb-24">
        <div className="ns-shimmer rounded-xl h-64" />
      </div>
    );
  }

  if (order === "missing") {
    return (
      <div className="ns-container pb-24">
        <div className="border-line rounded-xl flex flex-col items-center border border-dashed py-20 text-center">
          <div className="h-24 w-24 opacity-70">
            <BrandWave rings={3} color="var(--color-brand)" speed={8} />
          </div>
          <h2 className="font-display text-ink mt-6 text-xl font-semibold">
            {rtl ? "لم نجد هذا الطلب" : "We could not find that order"}
          </h2>
          <p className="text-smoke mt-2 max-w-sm text-[0.9375rem]">
            {rtl
              ? `لا يوجد طلب برقم ${reference} على هذا الحساب. تأكد من تسجيل الدخول بالحساب الذي طلبت منه.`
              : `There is no order ${reference} on this account. Check you are signed in with the account you ordered from.`}
          </p>
          <Link href="/orders" className="mt-7">
            <Button variant="secondary" size="lg">
              {rtl ? "كل الطلبات" : "All orders"}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const terminal = order.status === "cancelled" || order.status === "refunded";
  const progress = fulfilmentProgress(order.status);
  const currentIndex = FULFILMENT_STEPS.indexOf(order.status);

  return (
    <div className="ns-container grid gap-8 pb-24 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
      <div className="space-y-6">
        {/* Header card */}
        <div className="bg-paper-raised border-line rounded-xl border p-6 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-eyebrow text-mist uppercase">
                {rtl ? "رقم الطلب" : "Order"}
              </p>
              <p className="font-display text-ink mt-1 text-2xl font-semibold tracking-wide">
                {order.reference}
              </p>
              <p className="text-smoke mt-1 text-[0.8125rem]">
                {rtl ? "بتاريخ" : "Placed"} {formatDate(order.createdAt, locale)}
              </p>
            </div>
            <StatusChip status={order.status} locale={locale} />
          </div>

          {!terminal && (
            <>
              {/* Progress rail */}
              <div className="mt-8">
                <div className="bg-line relative h-1 rounded-full">
                  <motion.div
                    className="bg-brand absolute inset-y-0 start-0 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress * 100}%` }}
                    transition={{ duration: 1, ease: EASE.brand }}
                  />
                </div>

                <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {FULFILMENT_STEPS.map((step, index) => {
                    const done = index <= currentIndex;
                    const current = index === currentIndex;
                    return (
                      <li key={step} className="text-center">
                        <motion.span
                          className={cn(
                            "mx-auto grid h-6 w-6 place-items-center rounded-full text-[0.625rem]",
                            done ? "bg-brand text-white" : "bg-paper-sunken text-mist",
                            current && "ring-brand/30 ring-4",
                          )}
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.1 + index * 0.08, duration: 0.4, ease: EASE.spring }}
                        >
                          {done ? "✓" : index + 1}
                        </motion.span>
                        <span
                          className={cn(
                            "mt-2 block text-[0.6875rem] leading-tight",
                            current ? "text-ink font-medium" : "text-mist",
                          )}
                        >
                          {STATUS_LABELS[step][locale]}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {order.estimatedDeliveryAt && (
                <p className="bg-brand-veil text-ink rounded-md mt-6 p-4 text-[0.875rem]">
                  {rtl ? "الوصول المتوقع" : "Estimated arrival"}:{" "}
                  <strong className="font-medium">
                    {formatDate(order.estimatedDeliveryAt, locale)}
                  </strong>
                  {" · "}
                  <span className="text-smoke">
                    {t(order.shippingMethod.name, locale)},{" "}
                    {formatDeliveryWindow(
                      order.shippingMethod.minDays,
                      order.shippingMethod.maxDays,
                      locale,
                    )}
                  </span>
                </p>
              )}

              {order.trackingNumber && (
                <div className="border-line mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                  <span className="text-smoke text-[0.8125rem]">
                    {rtl ? "رقم التتبّع" : "Tracking number"}:{" "}
                    <span className="text-ink font-medium tabular-nums">{order.trackingNumber}</span>
                  </span>
                  {order.trackingUrl && (
                    <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="secondary" size="sm">
                        {rtl ? "تتبّع لدى الناقل" : "Track with carrier"}
                      </Button>
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Timeline */}
        {order.timeline.length > 0 && (
          <div className="bg-paper-raised border-line rounded-xl border p-6 md:p-7">
            <h2 className="font-display text-ink mb-5 text-lg font-semibold">
              {rtl ? "السجل" : "History"}
            </h2>
            <ol className="relative space-y-5 ps-6">
              <span className="bg-line absolute inset-y-1 start-[5px] w-px" aria-hidden="true" />
              {[...order.timeline].reverse().map((event, index) => (
                <motion.li
                  key={`${event.status}-${event.at}`}
                  className="relative"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.06, duration: 0.4, ease: EASE.brand }}
                >
                  <span
                    className={cn(
                      "absolute -start-6 top-1.5 h-2.5 w-2.5 rounded-full",
                      index === 0 ? "bg-brand ring-brand/25 ring-4" : "bg-line-strong",
                    )}
                    aria-hidden="true"
                  />
                  <p className="text-ink text-[0.875rem] font-medium">
                    {STATUS_LABELS[event.status][locale]}
                  </p>
                  <p className="text-smoke mt-0.5 text-[0.75rem]">
                    {formatDate(event.at, locale)}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                  {event.note && (
                    <p className="text-mist mt-1 text-[0.75rem]">{t(event.note, locale)}</p>
                  )}
                </motion.li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Summary */}
      <aside className="lg:sticky lg:top-32 lg:self-start">
        <div className="bg-paper-raised border-line rounded-xl border p-6">
          <h2 className="font-display text-ink mb-5 text-base font-semibold">
            {rtl ? "تفاصيل الطلب" : "Order details"}
          </h2>

          <ul className="space-y-4">
            {order.items.map((item) => (
              <li key={item.key} className="flex gap-3">
                <Link
                  href={`/product/${item.slug}`}
                  className="bg-paper-sunken rounded-sm relative h-20 w-15 shrink-0 overflow-hidden"
                >
                  <Image src={item.image.url} alt="" fill sizes="60px" className="object-cover" />
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="text-ink truncate text-[0.8125rem] font-medium">
                    {t(item.title, locale)}
                  </p>
                  <p className="text-smoke mt-0.5 text-[0.75rem]">
                    {lineOptions(item, locale).join(" · ")}{" "}
                    · ×{item.quantity}
                  </p>
                  <p className="text-ink mt-1 text-[0.8125rem] tabular-nums">
                    {formatPrice(item.unitPrice * item.quantity, item.currency, locale)}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <dl className="border-line mt-5 space-y-2 border-t pt-5 text-[0.875rem]">
            <div className="flex justify-between">
              <dt className="text-smoke">{rtl ? "المجموع الفرعي" : "Subtotal"}</dt>
              <dd className="text-ink tabular-nums">
                {formatPrice(order.totals.subtotal, order.totals.currency, locale)}
              </dd>
            </div>
            {order.totals.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-smoke">{rtl ? "الخصم" : "Discount"}</dt>
                <dd className="text-mint tabular-nums">
                  −{formatPrice(order.totals.discount, order.totals.currency, locale)}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-smoke">{rtl ? "الشحن" : "Delivery"}</dt>
              <dd className="text-ink tabular-nums">
                {order.totals.shipping === 0
                  ? rtl
                    ? "مجاني"
                    : "Free"
                  : formatPrice(order.totals.shipping, order.totals.currency, locale)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-smoke">{rtl ? "الضريبة" : "VAT"}</dt>
              <dd className="text-ink tabular-nums">
                {formatPrice(order.totals.tax, order.totals.currency, locale)}
              </dd>
            </div>
            <div className="border-line flex items-baseline justify-between border-t pt-3">
              <dt className="font-display text-ink font-semibold">{rtl ? "الإجمالي" : "Total"}</dt>
              <dd className="font-display text-ink text-lg font-semibold tabular-nums">
                {formatPrice(order.totals.total, order.totals.currency, locale)}
              </dd>
            </div>
          </dl>

          <div className="border-line mt-5 border-t pt-5">
            <p className="text-eyebrow text-mist mb-2 uppercase">
              {rtl ? "التوصيل إلى" : "Delivering to"}
            </p>
            <p className="text-ink text-[0.8125rem] leading-relaxed">
              {order.shippingAddress.fullName}
              <br />
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}
              <br />
              {order.shippingAddress.city}, {order.shippingAddress.countryCode}
            </p>
          </div>

          <Link href="/help/returns" className="mt-6 block">
            <Button variant="ghost" size="md" fullWidth>
              {rtl ? "طلب إرجاع" : "Start a return"}
            </Button>
          </Link>
        </div>
      </aside>
    </div>
  );
}
