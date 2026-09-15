"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { Link } from "@/components/ui/Link";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";
import { useAuth } from "@/components/providers/AuthProvider";
import { getIdToken } from "@/lib/firebase/auth";
import { ApiError, errorMessage, readJson } from "@/lib/errors";
import { MAX_MESSAGE, TOPICS, statusLabel, topicLabel } from "@/lib/support";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Locale, SupportTicket, TicketTopic } from "@/types";

/**
 * Talking to support, from the customer's side.
 *
 * The shop had an email address and a phone number on a contact page, and an
 * inbox in the admin that no customer could reach. This is the missing half: a
 * thread the customer can open, read, and answer, with support's replies
 * landing in the same conversation rather than in an inbox they do not have.
 *
 * Three decisions worth naming:
 *
 *  1. **Signed in only.** A conversation has to belong to somebody or it
 *     cannot be shown back to them, and an anonymous thread is a thread the
 *     customer loses the moment they close the tab. The email address stays on
 *     the page above for anyone who would rather not have an account.
 *
 *  2. **Polled, not live.** A socket or an `onSnapshot` would be prettier, and
 *     would put ~190KB of Firestore into a page most visitors never open. It
 *     refreshes every few seconds while the tab is in front, and stops when it
 *     is not — support is measured in minutes, not milliseconds.
 *
 *  3. **Nothing is optimistic.** A message appears once the server has it.
 *     Showing it immediately and reconciling later reads better right up until
 *     the write fails, and "did my complaint send?" is the one question this
 *     screen must never leave open.
 */

const POLL_MS = 12_000;

interface Loaded {
  ok?: boolean;
  tickets?: SupportTicket[];
}

export function SupportChat({ locale = "en" }: { locale?: Locale }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const rtl = locale === "ar";

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [topic, setTopic] = useState<TicketTopic>("delivery");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const token = await getIdToken().catch(() => null);
      if (!token) throw new ApiError("");

      const response = await fetch("/api/support", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJson<Loaded>(response);

      setTickets(data.tickets ?? []);
      setLoadError(null);
    } catch (error) {
      setTickets((current) => current ?? []);
      setLoadError(
        errorMessage(error, locale, {
          en: "Your conversations could not be loaded.",
          ar: "تعذّر تحميل محادثاتك.",
        }),
      );
    }
  }, [locale]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void load();
  }, [status, load]);

  /* Refresh while the tab is in front, so a reply arrives without a reload. */
  useEffect(() => {
    if (status !== "authenticated") return;

    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [status, load]);

  const active = tickets?.find((ticket) => ticket.id === activeId) ?? null;

  // Open the most recent thread by default; a customer with one conversation
  // should not have to choose it.
  useEffect(() => {
    if (!tickets || activeId || composing) return;
    if (tickets.length > 0) setActiveId(tickets[0]!.id);
  }, [tickets, activeId, composing]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [active?.messages.length, activeId]);

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;

    setSending(true);
    setSendError(null);

    try {
      const token = await getIdToken().catch(() => null);
      if (!token) throw new ApiError("");

      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...(active && !composing ? { ticketId: active.id } : { topic }),
          body: message,
          locale,
        }),
      });

      const data = await readJson<{ ok?: boolean; ticketId?: string }>(response);

      setDraft("");
      setComposing(false);
      if (data.ticketId) setActiveId(data.ticketId);
      await load();
    } catch (error) {
      setSendError(
        errorMessage(error, locale, {
          en: "Your message was not sent. Please try again.",
          ar: "لم تُرسل رسالتك. حاول مرة أخرى.",
        }),
      );
    } finally {
      setSending(false);
    }
  }

  /* ---- states before the conversation ---------------------------------- */

  if (status === "loading") {
    return (
      <Frame locale={locale}>
        <div className="grid place-items-center py-12">
          <div className="h-12 w-12 opacity-60">
            <BrandWave rings={3} color="var(--color-brand)" speed={5} />
          </div>
          <span className="sr-only">{rtl ? "جارٍ التحميل" : "Loading"}</span>
        </div>
      </Frame>
    );
  }

  if (status !== "authenticated") {
    return (
      <Frame locale={locale}>
        <p className="text-ink-muted text-[0.9375rem] leading-relaxed">
          {rtl
            ? "سجّل الدخول لتبدأ محادثة مع الدعم — نحفظ المحادثة في حسابك حتى ترى الرد متى عدت."
            : "Sign in to start a conversation with support — it is kept in your account, so the reply is here whenever you come back."}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/login?next=${encodeURIComponent(pathname ?? "/help/contact")}`}>
            <Button variant="brand" size="md">
              {rtl ? "تسجيل الدخول" : "Sign in"}
            </Button>
          </Link>
          <Link href={`/register?next=${encodeURIComponent(pathname ?? "/help/contact")}`}>
            <Button variant="secondary" size="md">
              {rtl ? "إنشاء حساب" : "Create an account"}
            </Button>
          </Link>
        </div>
      </Frame>
    );
  }

  const showComposer = composing || !tickets || tickets.length === 0;

  return (
    <Frame locale={locale}>
      {loadError && (
        <p role="alert" className="text-alert mb-4 text-[0.8125rem]">
          {loadError}
        </p>
      )}

      {/* Threads, when there is more than one to choose between. */}
      {tickets && tickets.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => {
                setActiveId(ticket.id);
                setComposing(false);
                setSendError(null);
              }}
              className={cn(
                "rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors",
                ticket.id === activeId && !composing
                  ? "border-ink bg-ink text-white"
                  : "border-line text-ink-muted hover:border-ink",
              )}
              data-cursor="hover"
            >
              <span className="font-medium">{topicLabel(ticket.topic, locale)}</span>
              <span className="mx-1.5 opacity-50" aria-hidden="true">
                ·
              </span>
              <span className="tabular-nums">{ticket.reference}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setComposing(true);
              setSendError(null);
            }}
            className={cn(
              "rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors",
              composing ? "border-brand text-brand" : "border-line text-mist hover:border-ink",
            )}
            data-cursor="hover"
          >
            {rtl ? "محادثة جديدة" : "New conversation"}
          </button>
        </div>
      )}

      {/* The thread itself. */}
      {active && !composing && (
        <>
          <header className="border-line mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
            <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
              {active.subject}
            </h3>
            <p className="text-mist text-[0.6875rem]">
              {statusLabel(active.status, locale)}
              <span className="mx-1.5 opacity-50" aria-hidden="true">
                ·
              </span>
              <span className="tabular-nums">{active.reference}</span>
            </p>
          </header>

          <div
            ref={threadRef}
            className="max-h-[22rem] space-y-3 overflow-y-auto pe-1"
            role="log"
            aria-live="polite"
            aria-label={rtl ? "المحادثة" : "Conversation"}
          >
            <AnimatePresence initial={false}>
              {active.messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={transition.base}
                  className={cn("flex", message.fromStaff ? "justify-start" : "justify-end")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-4 py-2.5",
                      message.fromStaff ? "bg-brand text-white" : "bg-paper-sunken text-ink",
                    )}
                  >
                    <p
                      className={cn(
                        "text-[0.625rem]",
                        message.fromStaff ? "text-white/60" : "text-mist",
                      )}
                    >
                      {message.fromStaff
                        ? rtl
                          ? "الدعم"
                          : "Support"
                        : rtl
                          ? "أنت"
                          : "You"}
                      <span className="mx-1.5 opacity-50" aria-hidden="true">
                        ·
                      </span>
                      <time dateTime={new Date(message.at).toISOString()}>
                        {new Intl.DateTimeFormat(rtl ? "ar-JO" : "en-JO", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(message.at)}
                      </time>
                    </p>
                    <p className="mt-1 text-[0.875rem] leading-relaxed whitespace-pre-line">
                      {message.body}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      {/* Nothing yet, or a deliberate new thread. */}
      {showComposer && (
        <div className="mb-4">
          <p className="text-ink-muted text-[0.875rem] leading-relaxed">
            {rtl
              ? "اكتب ما تحتاجه وسيرد عليك شخص من الفريق هنا. لا ترسل رقم بطاقتك أو كلمة المرور."
              : "Write what you need and someone from the team will answer here. Never send a card number or a password."}
          </p>

          <label className="mt-4 block">
            <span className="text-eyebrow text-mist mb-1.5 block uppercase">
              {rtl ? "الموضوع" : "Topic"}
            </span>
            <select
              value={topic}
              onChange={(event) => setTopic(event.target.value as TicketTopic)}
              className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.875rem] outline-none transition-colors"
            >
              {TOPICS.map((value) => (
                <option key={value} value={value}>
                  {topicLabel(value, locale)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* The composer, shared by both. */}
      <div className="mt-4">
        <label className="block">
          <span className="sr-only">{rtl ? "رسالتك" : "Your message"}</span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_MESSAGE))}
            rows={3}
            placeholder={
              showComposer
                ? rtl
                  ? "ما الذي يمكننا مساعدتك فيه؟"
                  : "What can we help with?"
                : rtl
                  ? "اكتب رداً…"
                  : "Write a reply…"
            }
            className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-full resize-y rounded-md border px-3 py-2.5 text-[0.875rem] outline-none transition-colors"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-mist text-[0.6875rem] tabular-nums">
            {draft.length > MAX_MESSAGE - 500 ? `${draft.length} / ${MAX_MESSAGE}` : ""}
          </p>
          <Button
            variant="brand"
            size="sm"
            loading={sending}
            disabled={!draft.trim()}
            onClick={send}
          >
            {showComposer
              ? rtl
                ? "ابدأ المحادثة"
                : "Start the conversation"
              : rtl
                ? "إرسال"
                : "Send"}
          </Button>
        </div>

        {sendError && (
          <p role="alert" className="text-alert mt-2 text-[0.8125rem]">
            {sendError}
          </p>
        )}
      </div>
    </Frame>
  );
}

/** One card, so the chat reads as a thing on the page rather than loose parts. */
function Frame({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  const rtl = locale === "ar";
  return (
    <section
      className="border-line bg-paper rounded-xl border p-5 sm:p-6"
      aria-label={rtl ? "التواصل مع الدعم" : "Talk to support"}
    >
      <p className="text-eyebrow text-brand mb-1 uppercase">
        {rtl ? "الدعم" : "Support"}
      </p>
      <h2 className="font-display text-ink mb-4 text-xl font-semibold tracking-tight">
        {rtl ? "تواصل مع الدعم" : "Talk to support"}
      </h2>
      {children}
    </section>
  );
}
