"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { motion } from "motion/react";

import { EASE } from "@/lib/motion";
import { formatDate, formatPrice, t } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import { fetchOrders } from "@/lib/firebase/orders";
import { StatusChip } from "./AccountPanel";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";
import type { Locale, Order } from "@/types";

/**
 * Order history.
 *
 * Shows product thumbnails rather than a table of references — customers
 * recognise the coat they bought far faster than they recognise `NS-7K4M2X`,
 * and finding the right order is the whole job of this screen.
 */
export function OrdersList({ locale = "en" }: { locale?: Locale }) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const rtl = locale === "ar";

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void fetchOrders(user.uid, 50)
      .then((rows) => !cancelled && setOrders(rows))
      .catch(() => !cancelled && setOrders([]));

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (orders === null) {
    return (
      <div className="ns-container space-y-4 pb-24">
        {[0, 1, 2].map((i) => (
          <div key={i} className="ns-shimmer rounded-xl h-36" />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="ns-container pb-24">
        <div className="border-line rounded-xl flex flex-col items-center border border-dashed py-20 text-center">
          <div className="h-24 w-24 opacity-70">
            <BrandWave rings={3} color="var(--color-brand)" speed={8} />
          </div>
          <h2 className="font-display text-ink mt-6 text-xl font-semibold">
            {rtl ? "لا توجد طلبات بعد" : "No orders yet"}
          </h2>
          <p className="text-smoke mt-2 max-w-sm text-[0.9375rem]">
            {rtl
              ? "عندما تطلب شيئاً، ستجد تتبّعه هنا خطوة بخطوة."
              : "When you order something, you'll be able to follow it here at every step."}
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
    <div className="ns-container space-y-4 pb-24">
      {orders.map((order, index) => (
        <motion.article
          key={order.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(index * 0.05, 0.3), duration: 0.45, ease: EASE.brand }}
          className="bg-paper-raised border-line rounded-xl hover:shadow-lift border p-5 transition-shadow md:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link
                href={`/orders/${order.reference}`}
                className="font-display text-ink ns-underline text-[1.0625rem] font-semibold tracking-wide"
                data-cursor="hover"
              >
                {order.reference}
              </Link>
              <p className="text-smoke mt-1 text-[0.8125rem]">
                {formatDate(order.createdAt, locale)} · {order.items.length}{" "}
                {rtl ? "قطعة" : order.items.length === 1 ? "item" : "items"} ·{" "}
                {formatPrice(order.totals.total, order.totals.currency, locale)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <StatusChip status={order.status} locale={locale} />
              <Link href={`/orders/${order.reference}`}>
                <Button variant="secondary" size="sm">
                  {rtl ? "تتبّع" : "Track"}
                </Button>
              </Link>
            </div>
          </div>

          <ul className="mt-5 flex flex-wrap gap-2">
            {order.items.slice(0, 6).map((item) => (
              <li
                key={item.key}
                className="bg-paper-sunken rounded-sm relative h-16 w-12 overflow-hidden"
                title={t(item.title, locale)}
              >
                <Image src={item.image.url} alt="" fill sizes="48px" className="object-cover" />
              </li>
            ))}
            {order.items.length > 6 && (
              <li className="bg-paper-sunken text-smoke rounded-sm grid h-16 w-12 place-items-center text-[0.75rem] tabular-nums">
                +{order.items.length - 6}
              </li>
            )}
          </ul>
        </motion.article>
      ))}
    </div>
  );
}
