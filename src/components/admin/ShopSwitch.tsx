"use client";

import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminUI";
import { useAdminLocale } from "./AdminLocale";
import {
  DEFAULT_STOREFRONT,
  REASON_LABELS,
  STATE_LABELS,
  STATE_NOTES,
  type ClosureReason,
  type StorefrontSettings,
  type StorefrontState,
} from "@/lib/storefront-state";

/**
 * The switch that closes the shop.
 *
 * Three things this screen is arranged around:
 *
 * **Closing asks once.** Not because the operator might not mean it, but
 * because the click is small and the consequence is every sale. Reopening does
 * not ask — friction belongs on the dangerous direction only.
 *
 * **The reopening time is offered every time.** The failure this control
 * actually has is not a wrong click, it is a right click that nobody undoes:
 * closed for twenty minutes of stock-taking, called away, dark until a
 * customer writes in. A time set here lifts the closure by itself.
 *
 * **The state and the reason are separate.** "Closed for maintenance" and
 * "restocking, look but do not order" are different closures, and a single
 * dropdown of reasons would force them to behave the same way.
 */

const field =
  "border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none transition-colors";

const STATES: StorefrontState[] = ["open", "browse-only", "closed"];
const REASONS = Object.keys(REASON_LABELS) as ClosureReason[];

/** `datetime-local` wants a local wall-clock string, not an ISO instant. */
function toLocalInput(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function ShopSwitch() {
  const { t, locale, rtl } = useAdminLocale();

  const [settings, setSettings] = useState<StorefrontSettings>(DEFAULT_STOREFRONT);
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getIdToken().catch(() => null);
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : { "Content-Type": "application/json" };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/admin/storefront", { headers: await authHeaders() });
        if (response.status === 403) {
          if (live) setDenied(true);
          return;
        }
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          settings?: StorefrontSettings;
        };
        if (!live) return;
        if (!response.ok || !data.ok) throw new Error(data.error ?? "That could not be read.");
        if (data.settings) setSettings(data.settings);
        setLoaded(true);
      } catch (failure) {
        if (live) setError(failure instanceof Error ? failure.message : "That could not be read.");
      }
    })();
    return () => {
      live = false;
    };
  }, [authHeaders]);

  async function save(next: StorefrontSettings) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/admin/storefront", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ settings: next }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        settings?: StorefrontSettings;
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");
      // What the server stored, not what was typed: it drops a reopening time
      // that has already passed, and the form should show that it did.
      if (data.settings) setSettings(data.settings);
      setSaved(true);
      setConfirming(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof StorefrontSettings>(key: K, value: StorefrontSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  if (denied) {
    return (
      <Panel title={t("shop.title")}>
        <p className="text-mist text-[0.8125rem]">{t("shop.adminOnly")}</p>
      </Panel>
    );
  }

  const closing = settings.state === "closed";

  return (
    <Panel
      title={t("shop.title")}
      description={t("shop.hint")}
      actions={
        <Button
          variant={closing ? "secondary" : "brand"}
          size="sm"
          loading={busy}
          disabled={!loaded}
          onClick={() => {
            // Only shutting the shop asks. Opening it is the safe direction.
            if (closing) setConfirming(true);
            else void save(settings);
          }}
        >
          {busy ? t("shop.saving") : t("shop.save")}
        </Button>
      }
    >
      <div className="space-y-5">
        {/* ---- the state ------------------------------------------------ */}
        <div>
          <span className="text-ink-muted mb-2 block text-[0.75rem]">{t("shop.state")}</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {STATES.map((state) => {
              const on = settings.state === state;
              return (
                <button
                  key={state}
                  type="button"
                  onClick={() => set("state", state)}
                  className={cn(
                    "cursor-pointer rounded-md border px-3 py-2.5 text-start transition-colors",
                    on
                      ? state === "open"
                        ? "border-mint bg-mint/10"
                        : "border-alert bg-alert/10"
                      : "border-line hover:border-ink",
                  )}
                  data-cursor="hover"
                >
                  <span className="text-ink block text-[0.8125rem] font-medium">
                    {STATE_LABELS[state][locale]}
                  </span>
                  <span className="text-mist mt-1 block text-[0.6875rem] leading-relaxed">
                    {STATE_NOTES[state][locale]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {settings.state !== "open" && (
          <>
            {/* ---- the reason --------------------------------------------- */}
            <div>
              <span className="text-ink-muted mb-2 block text-[0.75rem]">{t("shop.reason")}</span>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => set("reason", reason)}
                    className={cn(
                      "rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors",
                      settings.reason === reason
                        ? "border-ink bg-ink text-paper"
                        : "border-line text-ink-muted hover:border-ink",
                    )}
                    data-cursor="hover"
                  >
                    {REASON_LABELS[reason][locale]}
                  </button>
                ))}
              </div>
            </div>

            {/* ---- reopening ---------------------------------------------- */}
            <div className="border-line bg-paper-sunken rounded-md border px-3 py-3">
              <label className="block">
                <span className="text-ink mb-1.5 block text-[0.8125rem] font-medium">
                  {t("shop.reopensAt")}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={toLocalInput(settings.reopensAt)}
                    onChange={(e) =>
                      set(
                        "reopensAt",
                        e.target.value ? new Date(e.target.value).getTime() : undefined,
                      )
                    }
                    className={cn(field, "max-w-[260px]")}
                  />
                  {settings.reopensAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => set("reopensAt", undefined)}
                    >
                      {t("shop.reopensClear")}
                    </Button>
                  )}
                </div>
                <span className="text-mist mt-1.5 block text-[0.6875rem] leading-relaxed">
                  {t("shop.reopensHint")}
                </span>
              </label>
            </div>

            {/* ---- wording ------------------------------------------------ */}
            <div>
              <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                {t("shop.message")}
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-mist mb-1 block text-[0.6875rem]">
                    {t("shop.messageAr")}
                  </span>
                  <textarea
                    dir="rtl"
                    rows={3}
                    value={settings.message?.ar ?? ""}
                    onChange={(e) =>
                      set("message", { en: settings.message?.en ?? "", ar: e.target.value })
                    }
                    className={cn(field, "resize-y")}
                    maxLength={400}
                  />
                </label>
                <label className="block">
                  <span className="text-mist mb-1 block text-[0.6875rem]">
                    {t("shop.messageEn")}
                  </span>
                  <textarea
                    dir="ltr"
                    rows={3}
                    value={settings.message?.en ?? ""}
                    onChange={(e) =>
                      set("message", { ar: settings.message?.ar ?? "", en: e.target.value })
                    }
                    className={cn(field, "resize-y")}
                    maxLength={400}
                  />
                </label>
              </div>
              <span className="text-mist mt-1.5 block text-[0.6875rem]">
                {t("shop.messageHint")}
              </span>
            </div>
          </>
        )}

        {saved && !error && (
          <p role="status" className={cn("text-mint text-[0.8125rem]", rtl && "text-end")}>
            {t("shop.saved")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-alert text-[0.8125rem]">
            {error}
          </p>
        )}
      </div>

      {/* ---- the one confirmation ------------------------------------- */}
      {confirming && (
        <div className="fixed inset-0 z-[200] grid place-items-center p-4">
          <button
            type="button"
            aria-label={t("shop.cancel")}
            onClick={() => !busy && setConfirming(false)}
            className="bg-ink/40 absolute inset-0 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("shop.confirmClose")}
            className="bg-paper-raised border-line rounded-xl shadow-float relative w-full max-w-md border p-5"
          >
            <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
              {t("shop.confirmClose")}
            </h3>
            <p className="text-ink-muted mt-3 text-[0.8125rem] leading-relaxed">
              {t("shop.confirmCloseBody")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                {t("shop.cancel")}
              </Button>
              <Button variant="brand" size="sm" loading={busy} onClick={() => void save(settings)}>
                {t("shop.confirmGo")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
