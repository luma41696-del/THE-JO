"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { useAuth } from "@/components/providers/AuthProvider";
import { signOut } from "@/lib/firebase/auth";
import { NetSaleMark } from "@/components/brand/NetSaleMark";

/**
 * Admin chrome.
 *
 * A fixed left rail rather than the storefront's floating bar. The two are
 * deliberately different: the shop is browsed and should feel like a magazine;
 * the admin is *operated*, and an operator needs every destination visible and
 * in the same place on every screen, not revealed on scroll.
 *
 * Internal tooling stays in English. A half-translated operations surface is
 * worse than one language done properly, and the audience is a team rather
 * than the shopper.
 */

const NAV: { group: string; items: { href: string; label: string; icon: ReactNode }[] }[] = [
  {
    group: "Trade",
    items: [
      { href: "/admin", label: "Dashboard", icon: <ChartIcon /> },
      { href: "/admin/orders", label: "Orders", icon: <BagIcon /> },
      { href: "/admin/invoices", label: "Invoices", icon: <DocIcon /> },
    ],
  },
  {
    group: "Catalogue",
    items: [
      { href: "/admin/products", label: "Products", icon: <TagIcon /> },
      { href: "/admin/offers", label: "Offers & campaigns", icon: <SparkIcon /> },
    ],
  },
  {
    group: "People",
    items: [
      { href: "/admin/customers", label: "Customers", icon: <UsersIcon /> },
      { href: "/admin/support", label: "Support", icon: <ChatIcon /> },
    ],
  },
];

export function AdminShell({
  children,
  live,
}: {
  children: ReactNode;
  /** False when the screen is rendering generated data, not Firestore. */
  live: boolean;
}) {
  const pathname = usePathname();
  const router = useLocalizedRouter();
  const { user, profile } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = (profile?.displayName ?? user?.email ?? "?")
    .split(/[\s@.]+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleSignOut() {
    await signOut();
    router.push("/");
  }

  const rail = (
    <>
      <Link href="/admin" className="flex items-center gap-2.5 px-2">
        <NetSaleMark className="h-8 w-8 shrink-0" title={null} />
        <span className="min-w-0">
          <span className="font-display text-ink block text-[0.875rem] font-semibold tracking-[0.14em] uppercase">
            net&nbsp;sale
          </span>
          <span className="text-mist block text-[0.6875rem] tracking-[0.1em] uppercase">
            Operations
          </span>
        </span>
      </Link>

      <nav className="mt-8 flex flex-1 flex-col gap-6" aria-label="Admin">
        {NAV.map((section) => (
          <div key={section.group}>
            <p className="text-mist mb-2 px-3 text-[0.625rem] font-medium tracking-[0.14em] uppercase">
              {section.group}
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                // `/admin` must not light up for `/admin/orders`.
                const active =
                  item.href === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(item.href);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[0.875rem] transition-colors",
                        active
                          ? "bg-ink text-white"
                          : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
                      )}
                      data-cursor="hover"
                    >
                      <span className={cn("shrink-0", active ? "text-white" : "text-mist")}>
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-line mt-4 border-t pt-4">
        {!live && (
          <p className="bg-brand-mist text-brand-deep mb-3 rounded-md px-3 py-2 text-[0.6875rem] leading-relaxed">
            <strong className="font-semibold">Sample data.</strong> Firestore has no
            orders yet, so these screens are showing a generated 120-day history.
          </p>
        )}

        <div className="flex items-center gap-2.5 px-1">
          <span className="bg-brand font-display grid h-8 w-8 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold text-white">
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-ink block truncate text-[0.75rem] font-medium">
              {profile?.displayName ?? "Staff"}
            </span>
            <span className="text-mist block truncate text-[0.6875rem]">{user?.email}</span>
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Link
            href="/"
            className="text-smoke hover:text-ink flex-1 rounded-md px-2 py-1.5 text-[0.75rem] transition-colors"
          >
            View store →
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-smoke hover:text-alert cursor-pointer rounded-md px-2 py-1.5 text-[0.75rem] transition-colors"
            data-cursor="hover"
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="bg-paper min-h-screen">
      {/* Desktop rail */}
      <aside className="border-line bg-paper-raised fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e p-5 lg:flex">
        {rail}
      </aside>

      {/* Mobile bar */}
      <header className="border-line bg-paper-raised sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2">
          <NetSaleMark className="h-7 w-7" title={null} />
          <span className="font-display text-[0.8125rem] font-semibold tracking-[0.14em] uppercase">
            Operations
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="text-ink grid h-9 w-9 cursor-pointer place-items-center rounded-md"
          data-cursor="hover"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="bg-ink/30 absolute inset-0 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            />
            <motion.aside
              className="bg-paper-raised absolute inset-y-0 start-0 flex w-72 flex-col p-5 shadow-hover"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={transition.drawer}
            >
              {rail}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="lg:ps-64">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE.brand }}
          className="p-5 md:p-8"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

/* --- page header, shared by every admin screen --------------------------- */

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-ink text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-smoke mt-1.5 max-w-2xl text-[0.9375rem]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* --- icons: 18px, 1.5 stroke -------------------------------------------- */

function ChartIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 15.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 12V8M9 12V4m4 8v-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 5.8h10l.8 9.2a.9.9 0 0 1-.9 1H4.1a.9.9 0 0 1-.9-1L4 5.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.4 7.4V5a2.6 2.6 0 0 1 5.2 0v2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4.5 2.5h6l3.5 3.5v9a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M10.5 2.5V6H14M6.5 9.5h5M6.5 12.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M8.2 2.5H15V9.3l-6.4 6.4a1 1 0 0 1-1.4 0l-5.3-5.3a1 1 0 0 1 0-1.4L8.2 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="11.6" cy="6" r="1.1" fill="currentColor" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.2 10.6 7l4.8 1.6L10.6 10.2 9 15l-1.6-4.8L2.6 8.6 7.4 7 9 2.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="7" cy="6.4" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.4 15c0-2.4 2.1-4 4.6-4s4.6 1.6 4.6 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12.4 4.2a2.4 2.4 0 0 1 0 4.6M13.4 11.4c1.4.5 2.3 1.7 2.3 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M15.5 9.2c0 3-2.9 5.4-6.5 5.4a7.9 7.9 0 0 1-2.2-.3L3 15.5l1.1-2.8A5.1 5.1 0 0 1 2.5 9.2c0-3 2.9-5.4 6.5-5.4s6.5 2.4 6.5 5.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
