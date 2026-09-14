"use client";

import { useEffect, useState } from "react";
import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { formatDate, formatPrice } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import { signOut, updateProfileDoc } from "@/lib/firebase/auth";
import { fetchOrders, STATUS_LABELS, statusTone } from "@/lib/firebase/orders";
import { useWishlist } from "@/lib/store/wishlist";
import { Button } from "@/components/ui/Button";
import type { Locale, Order } from "@/types";

/**
 * Account overview.
 *
 * Ordered by what customers actually come here to do: check an order, then
 * change an address, then everything else. Profile edits are optimistic — the
 * field updates immediately and reverts with a message if the write fails,
 * because a spinner on a name change is worse than a rare rollback.
 */
export function AccountPanel({ locale = "en" }: { locale?: Locale }) {
  const { user, profile, refreshProfile } = useAuth();
  const router = useLocalizedRouter();
  const rtl = locale === "ar";

  const wishCount = useWishlist((s) => s.ids.length);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [name, setName] = useState(profile?.displayName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setName(profile?.displayName ?? "");
  }, [profile?.displayName]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void fetchOrders(user.uid, 5)
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch(() => {
        // Rules rejection, offline, or no orders collection yet — an empty
        // state is the honest render, not an error page.
        if (!cancelled) setOrders([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function saveName() {
    if (!user || name.trim().length < 2) return;
    setSavingName(true);
    setSaveError(null);
    try {
      await updateProfileDoc(user.uid, { displayName: name.trim() });
      await refreshProfile();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch {
      setName(profile?.displayName ?? "");
      setSaveError(rtl ? "تعذّر الحفظ." : "Could not save that change.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.push("/");
    router.refresh();
  }

  const initials = (profile?.displayName ?? user?.email ?? "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="jo-container pb-24">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.8fr] lg:gap-12">
        {/* Identity + nav */}
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <div className="bg-paper-raised border-line rounded-xl border p-6">
            <div className="flex items-center gap-4">
              <span className="bg-violet font-display grid h-14 w-14 shrink-0 place-items-center rounded-full text-lg font-semibold text-white">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="font-display text-ink truncate font-semibold">
                  {profile?.displayName ?? (rtl ? "عميل" : "Customer")}
                </p>
                <p className="text-smoke truncate text-[0.8125rem]">{user?.email}</p>
              </div>
            </div>

            <dl className="border-line mt-6 grid grid-cols-3 gap-2 border-t pt-5 text-center">
              {[
                { value: orders?.length ?? 0, label: rtl ? "طلبات" : "Orders" },
                { value: wishCount, label: rtl ? "مفضلة" : "Saved" },
                {
                  value: profile?.fitProfile?.heightCm ? "✓" : "—",
                  label: rtl ? "المقاسات" : "Sizes",
                },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="font-display text-ink text-lg font-semibold tabular-nums">
                    {stat.value}
                  </dt>
                  <dd className="text-mist mt-0.5 text-[0.6875rem] tracking-wide uppercase">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <nav className="mt-4 flex flex-col gap-1">
            {[
              { href: "/orders", label: { en: "Orders & tracking", ar: "الطلبات والتتبّع" } },
              { href: "/wishlist", label: { en: "Wishlist", ar: "المفضلة" } },
              { href: "/fitting-room", label: { en: "Fitting room", ar: "غرفة القياس" } },
              { href: "/help/returns", label: { en: "Returns", ar: "الإرجاع" } },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-ink-muted hover:bg-paper-sunken hover:text-ink rounded-md flex items-center justify-between px-4 py-3 text-[0.875rem] transition-colors"
                data-cursor="hover"
              >
                {item.label[locale]}
                <span aria-hidden="true" className="text-mist rtl:rotate-180">
                  →
                </span>
              </Link>
            ))}

            <button
              type="button"
              onClick={handleSignOut}
              className="text-smoke hover:text-coral rounded-md mt-2 cursor-pointer px-4 py-3 text-start text-[0.875rem] transition-colors"
              data-cursor="hover"
            >
              {rtl ? "تسجيل الخروج" : "Sign out"}
            </button>
          </nav>
        </aside>

        {/* Content */}
        <div className="space-y-8">
          {/* Recent orders */}
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-ink text-lg font-semibold">
                {rtl ? "أحدث الطلبات" : "Recent orders"}
              </h2>
              <Link
                href="/orders"
                className="text-smoke hover:text-ink text-[0.8125rem] transition-colors"
              >
                {rtl ? "عرض الكل" : "View all"}
              </Link>
            </div>

            {orders === null ? (
              <div className="space-y-3">
                {[0, 1].map((i) => (
                  <div key={i} className="jo-shimmer rounded-lg h-24" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <div className="border-line rounded-lg border border-dashed p-10 text-center">
                <p className="text-smoke text-[0.9375rem]">
                  {rtl ? "لا توجد طلبات بعد." : "No orders yet."}
                </p>
                <Link href="/shop" className="mt-4 inline-block">
                  <Button variant="secondary" size="md">
                    {rtl ? "ابدأ التسوّق" : "Start shopping"}
                  </Button>
                </Link>
              </div>
            ) : (
              <ul className="space-y-3">
                {orders.map((order, index) => (
                  <motion.li
                    key={order.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.4, ease: EASE.jo }}
                  >
                    <Link
                      href={`/orders/${order.reference}`}
                      className="bg-paper-raised border-line hover:shadow-lift rounded-lg flex items-center justify-between gap-4 border p-5 transition-shadow"
                      data-cursor="hover"
                    >
                      <div className="min-w-0">
                        <p className="font-display text-ink text-[0.9375rem] font-semibold tracking-wide">
                          {order.reference}
                        </p>
                        <p className="text-smoke mt-1 text-[0.8125rem]">
                          {formatDate(order.createdAt, locale)} ·{" "}
                          {order.items.length} {rtl ? "قطعة" : "items"}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <StatusChip status={order.status} locale={locale} />
                        <p className="text-ink mt-2 text-[0.875rem] font-medium tabular-nums">
                          {formatPrice(order.totals.total, order.totals.currency, locale)}
                        </p>
                      </div>
                    </Link>
                  </motion.li>
                ))}
              </ul>
            )}
          </section>

          {/* Profile */}
          <section className="bg-paper-raised border-line rounded-xl border p-6">
            <h2 className="font-display text-ink mb-5 text-lg font-semibold">
              {rtl ? "بياناتك" : "Your details"}
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="displayName" className="text-ink-muted mb-1.5 block text-[0.8125rem]">
                  {rtl ? "الاسم" : "Name"}
                </label>
                <div className="flex gap-2">
                  <input
                    id="displayName"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="border-line focus:border-violet bg-paper text-ink rounded-md min-w-0 flex-1 border px-4 py-2.5 text-[0.9375rem] outline-none transition-colors"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    loading={savingName}
                    success={savedFlash}
                    successLabel="✓"
                    disabled={name.trim() === (profile?.displayName ?? "") || name.trim().length < 2}
                    onClick={saveName}
                  >
                    {rtl ? "حفظ" : "Save"}
                  </Button>
                </div>
                {saveError && (
                  <p role="alert" className="text-coral mt-1.5 text-[0.75rem]">
                    {saveError}
                  </p>
                )}
              </div>

              <div>
                <label className="text-ink-muted mb-1.5 block text-[0.8125rem]">
                  {rtl ? "البريد الإلكتروني" : "Email"}
                </label>
                <p className="border-line bg-paper-sunken text-smoke rounded-md border px-4 py-2.5 text-[0.9375rem]">
                  {user?.email}
                </p>
              </div>
            </div>

            <p className="text-mist mt-4 text-[0.75rem]">
              {rtl
                ? "لتغيير البريد أو كلمة المرور، استخدم رابط إعادة التعيين في صفحة تسجيل الدخول."
                : "To change your email or password, use the reset link on the sign-in page — both require re-authentication."}
            </p>
          </section>

          {/* Addresses */}
          <section className="bg-paper-raised border-line rounded-xl border p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-ink text-lg font-semibold">
                {rtl ? "العناوين" : "Addresses"}
              </h2>
              <span className="text-mist text-[0.75rem] tabular-nums">
                {profile?.addresses?.length ?? 0}
              </span>
            </div>

            {(profile?.addresses?.length ?? 0) === 0 ? (
              <p className="text-smoke text-[0.875rem]">
                {rtl
                  ? "سيُحفظ أول عنوان تستخدمه عند الدفع هنا."
                  : "The first address you use at checkout is saved here."}
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {profile!.addresses.map((address) => (
                  <li key={address.id} className="border-line rounded-md border p-4">
                    <p className="text-ink text-[0.875rem] font-medium">{address.fullName}</p>
                    <p className="text-smoke mt-1 text-[0.8125rem] leading-relaxed">
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ""}
                      <br />
                      {address.city}, {address.countryCode}
                    </p>
                    {address.isDefault && (
                      <span className="bg-violet-mist text-violet-deep rounded-xs mt-2 inline-block px-2 py-0.5 text-[0.6875rem]">
                        {rtl ? "الافتراضي" : "Default"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function StatusChip({ status, locale = "en" }: { status: Order["status"]; locale?: Locale }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "rounded-pill inline-block px-2.5 py-1 text-[0.6875rem] font-medium",
        tone === "done" && "bg-mint/12 text-mint",
        tone === "progress" && "bg-violet-mist text-violet-deep",
        tone === "neutral" && "bg-paper-sunken text-smoke",
        tone === "bad" && "bg-coral/12 text-coral",
      )}
    >
      {STATUS_LABELS[status][locale]}
    </span>
  );
}
