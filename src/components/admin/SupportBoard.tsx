"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Link } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { transition } from "@/lib/motion";
import { formatDate } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { AdminPageHeader } from "./AdminShell";
import { FilterChips, Panel, PriorityFlag, StatTile, TicketStatusPill } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { SupportTicket, TicketStatus } from "@/types";

/**
 * Support inbox.
 *
 * A two-pane reader — list on the left, thread on the right — rather than a
 * table that navigates away. Support is answered in runs of ten, and a layout
 * that costs a page load per ticket turns a twenty-minute job into an hour.
 *
 * The headline metric is **median first response**, not ticket count. Volume
 * says how busy you were; response time says whether the customer was left
 * waiting, which is the thing they actually remember.
 */

type Filter = "needs-reply" | "all" | TicketStatus;

/** Slower than the storefront's poll: an operator is reading, not waiting. */
const POLL_MS = 15_000;

export function SupportBoard({ tickets: initial }: { tickets: SupportTicket[] }) {
  const [tickets, setTickets] = useState(initial);
  const [filter, setFilter] = useState<Filter>("needs-reply");
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [reply, setReply] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const counts = useMemo(() => {
    const base: Partial<Record<Filter, number>> = {
      all: tickets.length,
      "needs-reply": tickets.filter((t) => t.status === "open" || t.status === "pending").length,
    };
    for (const ticket of tickets) base[ticket.status] = (base[ticket.status] ?? 0) + 1;
    return base;
  }, [tickets]);

  const stats = useMemo(() => {
    const responded = tickets
      .map((t) => t.firstResponseMinutes)
      .filter((m): m is number => typeof m === "number")
      .sort((a, b) => a - b);

    // Median, not mean: one ticket answered three days late would drag a mean
    // so far that the number stops describing a typical customer's experience.
    const median = responded.length
      ? responded[Math.floor(responded.length / 2)]!
      : 0;

    return {
      open: tickets.filter((t) => t.status === "open").length,
      awaiting: tickets.filter((t) => t.status === "pending").length,
      medianMinutes: median,
      resolvedShare: tickets.length
        ? tickets.filter((t) => t.status === "resolved" || t.status === "closed").length /
          tickets.length
        : 0,
    };
  }, [tickets]);

  const rows = useMemo(() => {
    if (filter === "needs-reply") {
      return tickets.filter((t) => t.status === "open" || t.status === "pending");
    }
    if (filter === "all") return tickets;
    return tickets.filter((t) => t.status === filter);
  }, [tickets, filter]);

  const selected = tickets.find((t) => t.id === selectedId) ?? rows[0] ?? null;

  /**
   * Send a reply.
   *
   * Optimistic, then reconciled. The UI updates immediately because a support
   * agent typing all day should not wait on a round trip — but the reply is
   * rolled back if the write fails, which is the half that was missing: this
   * used to update local state and stop, so staff saw replies that had never
   * been stored and vanished on refresh.
   */
  async function send() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    setSendError(null);

    const snapshot = tickets;
    const body = reply.trim();
    const now = Date.now();
    setTickets((current) =>
      current.map((ticket) =>
        ticket.id === selected.id
          ? {
              ...ticket,
              status: "pending",
              updatedAt: now,
              firstResponseMinutes:
                ticket.firstResponseMinutes ??
                Math.round((now - ticket.createdAt) / 60_000),
              messages: [
                ...ticket.messages,
                {
                  id: `local-${now}`,
                  authorId: "staff",
                  authorName: "net sale Support",
                  fromStaff: true,
                  body: reply.trim(),
                  at: now,
                },
              ],
            }
          : ticket,
      ),
    );

    setReply("");

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ticketId: selected.id, body }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        persisted?: boolean;
        delivered?: boolean;
        deliveryNote?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "The reply was not saved.");

      if (data.persisted === false) {
        // Roll back rather than leave a reply on screen that is not stored.
        setTickets(snapshot);
        setReply(body);
        setSendError(
          "Not saved: Firebase Admin is not configured in this environment.",
        );
      } else if (data.delivered === false && data.deliveryNote) {
        // Stored, but not emailed. Staff must know the customer has not been
        // pinged, or they will assume silence means the answer landed.
        setNotice(data.deliveryNote);
      }
    } catch (error) {
      setTickets(snapshot);
      setReply(body);
      setSendError(
        error instanceof Error ? error.message : "The reply could not be saved.",
      );
    } finally {
      setSending(false);
    }
  }

  /**
   * Resolve a ticket — for real.
   *
   * This used to move the pill in local state and stop there. The customer's
   * thread stayed open, the next refresh put it back, and the queue counted it
   * as unresolved while the person who closed it believed otherwise. The route
   * has always accepted a status; nothing was ever sending one.
   */
  async function setStatus(status: TicketStatus) {
    if (!selected) return;

    const snapshot = tickets;
    setSendError(null);
    setTickets((current) =>
      current.map((t) => (t.id === selected.id ? { ...t, status, updatedAt: Date.now() } : t)),
    );

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ticketId: selected.id, status }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; persisted?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "The status was not saved.");
      if (data.persisted === false) throw new Error("Not saved: Firebase Admin is not configured.");
    } catch (error) {
      setTickets(snapshot);
      setSendError(
        error instanceof Error ? error.message : "The status could not be saved.",
      );
    }
  }

  /**
   * Re-read the inbox while it is on screen.
   *
   * The board is server-rendered once. Customers can now write into a thread,
   * so an inbox left open is an inbox going quietly out of date — and support
   * answering from a stale thread is how a question gets answered twice or not
   * at all. Paused when the tab is behind: an unwatched board needs nothing.
   */
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const token = await getIdToken().catch(() => null);
        if (!token) return;
        const response = await fetch("/api/admin/support", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const data = (await response.json()) as { ok?: boolean; tickets?: SupportTicket[] };
        // `persisted: false` comes back with no tickets — that is "not
        // configured", not "inbox zero", and must not wipe the board.
        if (data.ok && Array.isArray(data.tickets) && data.tickets.length > 0) {
          setTickets(data.tickets);
        }
      } catch {
        // A failed refresh leaves the last good read on screen.
      }
    };

    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "needs-reply", label: "Needs reply" },
    { value: "all", label: "All" },
    { value: "open", label: "Open" },
    { value: "pending", label: "Waiting" },
    { value: "resolved", label: "Resolved" },
    { value: "closed", label: "Closed" },
  ];

  return (
    <>
      <AdminPageHeader
        title="Support"
        description="Answered in runs — the thread opens beside the list, not instead of it."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open" value={stats.open.toString()} emphasis={stats.open > 0} />
        <StatTile label="Awaiting customer" value={stats.awaiting.toString()} />
        <StatTile
          label="Median first reply"
          value={
            stats.medianMinutes >= 60
              ? `${(stats.medianMinutes / 60).toFixed(1)}h`
              : `${stats.medianMinutes}m`
          }
        />
        <StatTile label="Resolved" value={`${Math.round(stats.resolvedShare * 100)}%`} />
      </div>

      <div className="mb-4">
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        {/* List */}
        <Panel padded={false} className="max-h-[38rem] overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-smoke p-8 text-center text-[0.875rem]">
              Nothing here. Inbox zero.
            </p>
          ) : (
            <ul className="divide-line divide-y">
              {rows.map((ticket) => {
                const active = selected?.id === ticket.id;
                return (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(ticket.id)}
                      className={cn(
                        "w-full cursor-pointer px-4 py-3 text-start transition-colors",
                        active ? "bg-brand-veil" : "hover:bg-paper-sunken/60",
                      )}
                      data-cursor="hover"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-ink truncate text-[0.8125rem] font-medium">
                          {ticket.subject}
                        </span>
                        <PriorityFlag priority={ticket.priority} />
                      </span>
                      <span className="text-mist mt-1 flex items-center gap-2 text-[0.6875rem]">
                        <span className="truncate">{ticket.customerName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">{formatDate(ticket.updatedAt)}</span>
                      </span>
                      <span className="mt-2 flex items-center gap-2">
                        <TicketStatusPill status={ticket.status} />
                        <span className="text-mist text-[0.625rem] capitalize">{ticket.topic}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Thread */}
        {selected ? (
          <Panel padded={false}>
            <header className="border-line flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-display text-ink text-[0.9375rem] font-semibold">
                  {selected.subject}
                </h2>
                <p className="text-mist mt-1 text-[0.75rem]">
                  {selected.reference} · {selected.customerName} · {selected.email}
                  {selected.orderReference && (
                    <>
                      {" · "}
                      <Link
                        href={`/admin/orders/${selected.orderReference}`}
                        className="text-brand"
                      >
                        {selected.orderReference}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <TicketStatusPill status={selected.status} />
                {selected.status !== "resolved" && (
                  <Button variant="ghost" size="sm" onClick={() => setStatus("resolved")}>
                    Resolve
                  </Button>
                )}
              </div>
            </header>

            <div className="max-h-[22rem] space-y-4 overflow-y-auto p-5">
              <AnimatePresence initial={false}>
                {selected.messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={transition.base}
                    className={cn("flex", message.fromStaff ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-4 py-3",
                        message.fromStaff
                          ? "bg-brand text-white"
                          : "bg-paper-sunken text-ink",
                      )}
                    >
                      <p
                        className={cn(
                          "text-[0.6875rem]",
                          message.fromStaff ? "text-white/60" : "text-mist",
                        )}
                      >
                        {message.authorName} · {formatDate(message.at)}
                      </p>
                      <p className="mt-1.5 text-[0.875rem] leading-relaxed">{message.body}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <footer className="border-line border-t p-5">
              <label className="block">
                <span className="sr-only">Reply</span>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={3}
                  placeholder="Write a reply…"
                  className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-full resize-y rounded-md border px-3 py-2.5 text-[0.875rem] outline-none transition-colors"
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-mist min-w-0 text-[0.6875rem]">
                  {/* This used to claim it emailed the customer. It did not —
                      it did not even save. It now saves, and says plainly that
                      no email goes out until a provider is configured. */}
                  Saves the reply to the ticket and moves it to Waiting.
                </p>
                <Button
                  variant="brand"
                  size="sm"
                  loading={sending}
                  disabled={!reply.trim()}
                  onClick={send}
                >
                  Send reply
                </Button>
              </div>

              {sendError && (
                <p role="alert" className="text-alert mt-2 text-[0.75rem]">
                  {sendError}
                </p>
              )}

              {notice && !sendError && (
                <p role="status" className="text-smoke bg-paper-sunken rounded-sm mt-2 px-2.5 py-1.5 text-[0.75rem]">
                  {notice}
                </p>
              )}
            </footer>
          </Panel>
        ) : (
          <Panel>
            <p className="text-smoke py-16 text-center text-[0.875rem]">
              Select a ticket to read the thread.
            </p>
          </Panel>
        )}
      </div>
    </>
  );
}
