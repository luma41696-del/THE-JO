"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminUI";
import { useAdminLocale } from "./AdminLocale";
import {
  SEGMENT_LABELS,
  SEGMENT_NOTES,
  type SegmentId,
  type SegmentSummary,
} from "@/lib/admin/campaign-audience";
import { MAX_PRODUCTS, type CampaignProduct } from "@/lib/email/campaign-email";
import type { Locale } from "@/types";

/**
 * Writing a campaign and sending it.
 *
 * Three things this screen is arranged around:
 *
 * **The preview is the real email.** It comes from the send route's own
 * builder, rendered in an iframe, not a CSS approximation in the admin's own
 * styles. A preview produced by different code from the send is a preview of
 * nothing — and the differences show up in the one place nobody can check
 * afterwards, which is other people's inboxes.
 *
 * **The count is on the button.** Not "send campaign" — "send to 1,140". Email
 * cannot be recalled, and the number is the fact worth being sure about. The
 * confirmation is typing that number for the same reason: a word becomes
 * muscle memory, a number has to be read.
 *
 * **A test send is one click away and touches nothing.** It goes to an address
 * the operator types and reads no customer data at all, so trying a draft is
 * never one mistyped field away from mailing the shop.
 */

interface ProductOption {
  id: string;
  title: string;
  imageUrl?: string;
  price?: number;
  url?: string;
}

interface Draft {
  locale: Locale;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  heroUrl: string;
  productIds: string[];
}

const EMPTY: Draft = {
  locale: "ar",
  subject: "",
  preheader: "",
  heading: "",
  body: "",
  ctaLabel: "",
  ctaUrl: "",
  heroUrl: "",
  productIds: [],
};

const field =
  "border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none transition-colors";

export function CampaignComposer({ products }: { products: ProductOption[] }) {
  const { t, locale: adminLocale, rtl } = useAdminLocale();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [segment, setSegment] = useState<SegmentId>("opted-in");
  const [search, setSearch] = useState("");

  const [segments, setSegments] = useState<SegmentSummary[] | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [unsubscribed, setUnsubscribed] = useState(0);
  /*
   * "The server told me what is missing" and "I could not ask the server" are
   * different problems with different fixes, and collapsing them produced the
   * banner "Sending is not set up yet. Missing: —" for what was actually a
   * refused request. This holds the second case.
   */
  const [audienceError, setAudienceError] = useState<string | null>(null);

  const [html, setHtml] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getIdToken().catch(() => null);
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : { "Content-Type": "application/json" };
  }, []);

  const picked = useMemo(
    () =>
      draft.productIds
        .map((id) => products.find((product) => product.id === id))
        .filter((product): product is ProductOption => Boolean(product)),
    [draft.productIds, products],
  );

  const payload = useMemo(
    () => ({
      subject: draft.subject,
      preheader: draft.preheader,
      heading: draft.heading,
      body: draft.body,
      ctaLabel: draft.ctaLabel,
      ctaUrl: draft.ctaUrl,
      heroUrl: draft.heroUrl,
      locale: draft.locale,
      products: picked.map<CampaignProduct>((product) => ({
        title: product.title,
        imageUrl: product.imageUrl,
        price: product.price,
        url: product.url,
      })),
    }),
    [draft, picked],
  );

  /* ---- audience, once ---------------------------------------------------- */

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/admin/campaigns/audience", {
          headers: await authHeaders(),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          segments?: SegmentSummary[];
          ready?: boolean;
          missing?: string[];
          unsubscribed?: number;
        };
        if (!live) return;
        if (!response.ok || !data.ok) throw new Error(data.error ?? "That could not be read.");
        setSegments(data.segments ?? []);
        setReady(Boolean(data.ready));
        setMissing(data.missing ?? []);
        setUnsubscribed(data.unsubscribed ?? 0);
        setAudienceError(null);
      } catch (failure) {
        if (!live) return;
        setReady(false);
        setSegments([]);
        setAudienceError(
          failure instanceof Error && failure.message ? failure.message : "That could not be read.",
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [authHeaders]);

  /* ---- preview, debounced ------------------------------------------------ */

  useEffect(() => {
    if (!draft.subject.trim() || !draft.heading.trim()) {
      setHtml("");
      setPreviewError(null);
      return;
    }
    let live = true;
    // Debounced: a render per keystroke is a request per keystroke.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/admin/campaigns/preview", {
            method: "POST",
            headers: await authHeaders(),
            body: JSON.stringify({ draft: payload }),
          });
          const data = (await response.json()) as { ok?: boolean; html?: string; error?: string };
          if (!live) return;
          if (!response.ok || !data.ok) throw new Error(data.error ?? "");
          setHtml(data.html ?? "");
          setPreviewError(null);
        } catch (failure) {
          if (!live) return;
          setPreviewError(failure instanceof Error && failure.message ? failure.message : null);
        }
      })();
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [payload, draft.subject, draft.heading, authHeaders]);

  /* ---- actions ----------------------------------------------------------- */

  async function sendTest() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/campaigns/send", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ draft: payload, test: true, testTo }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");
      setNotice(t("cmp.testSent").replace("{n}", testTo));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setTesting(false);
    }
  }

  /**
   * The real send, one group at a time.
   *
   * The server decides who is in each group and hands back the next offset, so
   * the browser never carries the recipient list — a list the client held
   * could be edited, and somebody who unsubscribed between the first group and
   * the fourth must not be in the fourth.
   */
  async function sendAll() {
    setSending(true);
    setError(null);
    setNotice(null);

    let sent = 0;
    let failed = 0;
    let offset: number | null = 0;

    try {
      while (offset !== null) {
        const response: Response = await fetch("/api/admin/campaigns/send", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ draft: payload, segment, offset }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          sent?: number;
          failed?: { email: string }[];
          total?: number;
          nextOffset?: number | null;
        };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");

        sent += data.sent ?? 0;
        failed += data.failed?.length ?? 0;
        setProgress({ done: sent + failed, total: data.total ?? sendable });
        offset = data.nextOffset ?? null;
      }
      setResult({ sent, failed });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
      // Whatever went, went. Reporting zero would invite sending it all again.
      if (sent + failed > 0) setResult({ sent, failed });
    } finally {
      setProgress(null);
      setSending(false);
    }
  }

  /* ---- derived ----------------------------------------------------------- */

  const summary = segments?.find((entry) => entry.id === segment);
  const sendable = summary?.sendable ?? 0;
  const composed = Boolean(draft.subject.trim() && draft.heading.trim());
  const canSend = ready === true && composed && sendable > 0 && !sending;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle
      ? products.filter((product) => product.title.toLowerCase().includes(needle))
      : products;
    return list.slice(0, 40);
  }, [products, search]);

  function togglePick(id: string) {
    setDraft((current) => {
      if (current.productIds.includes(id)) {
        return { ...current, productIds: current.productIds.filter((x) => x !== id) };
      }
      if (current.productIds.length >= MAX_PRODUCTS) return current;
      return { ...current, productIds: [...current.productIds, id] };
    });
  }

  return (
    <div className="space-y-4">
      {/*
        The setup state, said once and at the top.

        Everything below works without a provider — writing, previewing,
        picking an audience. Only sending does not, and an operator should find
        that out before composing rather than after pressing the button.
      */}
      {audienceError ? (
        /* The request itself failed. Saying what is missing would be a guess. */
        <div className="border-line bg-paper-sunken rounded-lg border px-4 py-3">
          <p role="alert" className="text-alert text-[0.8125rem] font-medium">
            {audienceError}
          </p>
        </div>
      ) : (
        ready === false &&
        missing.length > 0 && (
          <div className="border-line bg-paper-sunken rounded-lg border px-4 py-3">
            <p className="text-ink text-[0.8125rem] font-medium">
              {t("cmp.notReady").replace("{n}", missing.join(", "))}
            </p>
            <p className="text-mist mt-1 text-[0.75rem]">{t("cmp.notReadyHint")}</p>
          </div>
        )
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        {/* ---- compose ---------------------------------------------------- */}
        <div className="space-y-4">
          <Panel title={t("cmp.compose")}>
            <div className="space-y-3.5">
              <div>
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                  {t("cmp.language")}
                </span>
                <div className="flex gap-2">
                  {(["ar", "en"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => set("locale", value)}
                      className={cn(
                        "rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors",
                        draft.locale === value
                          ? "border-ink bg-ink text-paper"
                          : "border-line text-ink-muted hover:border-ink",
                      )}
                      data-cursor="hover"
                    >
                      {value === "ar" ? "العربية" : "English"}
                    </button>
                  ))}
                </div>
                <p className="text-mist mt-1.5 text-[0.6875rem]">{t("cmp.languageHint")}</p>
              </div>

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                  {t("cmp.subject")}
                </span>
                <input
                  value={draft.subject}
                  onChange={(event) => set("subject", event.target.value)}
                  className={field}
                  maxLength={160}
                />
              </label>

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                  {t("cmp.preheader")}
                </span>
                <input
                  value={draft.preheader}
                  onChange={(event) => set("preheader", event.target.value)}
                  className={field}
                  maxLength={200}
                />
                <span className="text-mist mt-1.5 block text-[0.6875rem]">
                  {t("cmp.preheaderHint")}
                </span>
              </label>

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                  {t("cmp.heading")}
                </span>
                <input
                  value={draft.heading}
                  onChange={(event) => set("heading", event.target.value)}
                  className={field}
                  maxLength={120}
                />
              </label>

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{t("cmp.body")}</span>
                <textarea
                  value={draft.body}
                  onChange={(event) => set("body", event.target.value)}
                  rows={7}
                  className={cn(field, "resize-y leading-relaxed")}
                  maxLength={4000}
                />
                <span className="text-mist mt-1.5 block text-[0.6875rem]">
                  {t("cmp.bodyHint")}
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                    {t("cmp.ctaLabel")}
                  </span>
                  <input
                    value={draft.ctaLabel}
                    onChange={(event) => set("ctaLabel", event.target.value)}
                    className={field}
                    maxLength={40}
                  />
                </label>
                <label className="block">
                  <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                    {t("cmp.ctaUrl")}
                  </span>
                  <input
                    value={draft.ctaUrl}
                    onChange={(event) => set("ctaUrl", event.target.value)}
                    dir="ltr"
                    placeholder="https://netsale.shop/ar/shop"
                    className={cn(field, "font-mono text-[0.75rem]")}
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{t("cmp.hero")}</span>
                <input
                  value={draft.heroUrl}
                  onChange={(event) => set("heroUrl", event.target.value)}
                  dir="ltr"
                  placeholder="https://…"
                  className={cn(field, "font-mono text-[0.75rem]")}
                />
                <span className="text-mist mt-1.5 block text-[0.6875rem]">{t("cmp.heroHint")}</span>
              </label>
            </div>
          </Panel>

          {/* ---- product picks ------------------------------------------- */}
          <Panel
            title={t("cmp.products")}
            description={`${t("cmp.productsHint")} · ${picked.length}/${MAX_PRODUCTS}`}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("cmp.searchProducts")}
              className={cn(field, "mb-3")}
            />
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {shown.map((product) => {
                const on = draft.productIds.includes(product.id);
                const full = !on && picked.length >= MAX_PRODUCTS;
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={full}
                    onClick={() => togglePick(product.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-start transition-colors",
                      on ? "border-brand bg-brand-mist" : "border-transparent hover:bg-paper-sunken",
                      full && "cursor-not-allowed opacity-40",
                    )}
                    data-cursor="hover"
                  >
                    <span
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded border text-[0.625rem]",
                        on ? "border-brand bg-brand text-white" : "border-line",
                      )}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="text-ink truncate text-[0.8125rem]">{product.title}</span>
                  </button>
                );
              })}
              {shown.length === 0 && (
                <p className="text-mist px-1 py-3 text-[0.75rem]">—</p>
              )}
            </div>
          </Panel>
        </div>

        {/* ---- preview + audience + send ---------------------------------- */}
        <div className="space-y-4">
          <Panel title={t("cmp.preview")} description={t("cmp.previewNote")} padded={false}>
            {composed ? (
              <iframe
                // srcDoc in a sandboxed frame: the campaign's own HTML, with no
                // script, no forms and no access to the admin around it.
                srcDoc={html}
                sandbox=""
                title={t("cmp.preview")}
                className="h-[520px] w-full rounded-b-lg border-0 bg-white"
              />
            ) : (
              <p className="text-mist px-5 py-10 text-center text-[0.8125rem]">
                {t("cmp.needSubject")}
              </p>
            )}
            {previewError && (
              <p role="alert" className="text-alert px-5 py-2 text-[0.75rem]">
                {previewError}
              </p>
            )}
          </Panel>

          <Panel title={t("cmp.audience")}>
            <div className="space-y-2">
              {(segments ?? []).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSegment(entry.id)}
                  className={cn(
                    "block w-full cursor-pointer rounded-md border px-3 py-2.5 text-start transition-colors",
                    segment === entry.id
                      ? "border-brand bg-brand-mist"
                      : "border-line hover:border-ink",
                  )}
                  data-cursor="hover"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ink text-[0.8125rem] font-medium">
                      {SEGMENT_LABELS[entry.id][adminLocale]}
                    </span>
                    <span className="text-ink font-mono text-[0.8125rem] tabular-nums" dir="ltr">
                      {entry.sendable}
                    </span>
                  </div>
                  <p className="text-mist mt-1 text-[0.6875rem] leading-relaxed">
                    {SEGMENT_NOTES[entry.id][adminLocale]}
                  </p>
                </button>
              ))}
              {segments === null && <p className="text-mist text-[0.75rem]">…</p>}
              {unsubscribed > 0 && (
                <p className="text-mist pt-1 text-[0.6875rem]">
                  {t("cmp.suppressedNote").replace("{n}", String(unsubscribed))}
                </p>
              )}
            </div>
          </Panel>

          <Panel title={t("cmp.test")} description={t("cmp.testHint")}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[200px] flex-1">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                  {t("cmp.testTo")}
                </span>
                <input
                  value={testTo}
                  onChange={(event) => setTestTo(event.target.value)}
                  dir="ltr"
                  type="email"
                  placeholder="you@example.com"
                  className={cn(field, "font-mono text-[0.75rem]")}
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                loading={testing}
                disabled={!composed || !testTo.trim() || ready !== true}
                onClick={() => void sendTest()}
              >
                {t("cmp.test")}
              </Button>
            </div>
          </Panel>

          <div className="border-line bg-paper-raised rounded-lg border px-5 py-4">
            <p className="text-mist mb-3 text-[0.75rem] leading-relaxed">{t("cmp.irreversible")}</p>
            <Button
              variant="brand"
              disabled={!canSend}
              onClick={() => {
                setTyped("");
                setResult(null);
                setConfirming(true);
              }}
              className="w-full"
            >
              {t("cmp.send").replace("{n}", String(sendable))}
            </Button>
          </div>

          {notice && !error && (
            <p role="status" className="text-mint text-[0.8125rem]">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-alert text-[0.8125rem]">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* ---- the confirmation ------------------------------------------- */}
      {confirming && (
        <div className="fixed inset-0 z-[200] grid place-items-center p-4">
          <button
            type="button"
            aria-label={t("cmp.close")}
            onClick={() => !sending && setConfirming(false)}
            className="bg-ink/40 absolute inset-0 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("cmp.sendHeading")}
            className="bg-paper-raised border-line rounded-xl shadow-float relative w-full max-w-md border p-5"
            dir={rtl ? "rtl" : "ltr"}
          >
            <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
              {t("cmp.sendHeading")}
            </h3>

            {result ? (
              <>
                <p
                  role="status"
                  className={cn(
                    "mt-3 text-[0.8125rem]",
                    result.failed > 0 ? "text-ink" : "text-mint",
                  )}
                >
                  {result.failed > 0
                    ? t("cmp.sentPartial")
                        .replace("{ok}", String(result.sent))
                        .replace("{bad}", String(result.failed))
                    : t("cmp.sentAll").replace("{n}", String(result.sent))}
                </p>
                <div className="mt-5 flex justify-end">
                  <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                    {t("cmp.close")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-ink-muted mt-3 text-[0.8125rem] leading-relaxed">
                  {SEGMENT_LABELS[segment][adminLocale]} — {sendable}
                </p>
                <p className="text-mist mt-2 text-[0.75rem] leading-relaxed">
                  {t("cmp.irreversible")}
                </p>

                <label className="mt-4 block">
                  <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                    {t("cmp.sendConfirm")}{" "}
                    <span className="text-ink font-mono tabular-nums" dir="ltr">
                      {sendable}
                    </span>
                  </span>
                  <input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={sending}
                    className={cn(field, "font-mono tabular-nums")}
                  />
                </label>

                {progress && (
                  <p role="status" className="text-ink-muted mt-3 text-[0.75rem] tabular-nums">
                    {t("cmp.progress")
                      .replace("{done}", String(progress.done))
                      .replace("{total}", String(progress.total))}
                  </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={sending}
                    onClick={() => setConfirming(false)}
                  >
                    {t("cmp.cancel")}
                  </Button>
                  <Button
                    variant="brand"
                    size="sm"
                    loading={sending}
                    disabled={typed.trim() !== String(sendable) || sending}
                    onClick={() => void sendAll()}
                  >
                    {sending ? t("cmp.sending") : t("cmp.sendGo")}
                  </Button>
                </div>
              </>
            )}

            {error && (
              <p role="alert" className="text-alert mt-3 text-[0.8125rem]">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
