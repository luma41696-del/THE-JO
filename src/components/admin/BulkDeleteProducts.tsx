"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/Button";
import { useAdminLocale } from "./AdminLocale";
import type { DeletionPlan } from "@/lib/admin/delete-product";

/**
 * Deleting a whole selection for good.
 *
 * The same operation as the one on a product page, at the scale where it goes
 * wrong. Thirty-nine rows are selected by a filter and a click on the header
 * checkbox, and nobody has looked at thirty-nine of anything.
 *
 * So the dialog asks the server what would happen first and shows the counted
 * answer, and the confirmation is **the number of products**, typed. A typed
 * word — DELETE, or the shop's name — becomes muscle memory within a week and
 * stops being read. The number is the thing that is wrong when this goes
 * wrong, so the number is what has to be looked at and copied.
 *
 * ## Why it is sent in several requests
 *
 * A large selection goes up in groups, in turn, with the progress shown. One
 * request deleting two hundred products is a request that gets killed by a
 * function timeout partway through, and a timeout is the one failure with no
 * report to give — nobody would know which half went. The group size comes
 * from the server's own preview rather than a copy kept here.
 *
 * And it **stops at the first group with a refusal**. A product that would not
 * delete still holds its photographs, and a later group carrying on might
 * remove one they share — turning a failure into a broken image on a product
 * that is still in the shop.
 */

interface Failure {
  id: string;
  title: string;
  error?: string;
}

export function BulkDeleteProducts({
  ids,
  size = "md",
  onDeleted,
}: {
  ids: string[];
  size?: "sm" | "md";
  /** The ids that actually went, so the board can drop them from the selection. */
  onDeleted: (deletedIds: string[]) => void;
}) {
  const { t, rtl } = useAdminLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [summary, setSummary] = useState("");
  const [count, setCount] = useState(0);
  const [alreadyGone, setAlreadyGone] = useState(0);
  const [perRequest, setPerRequest] = useState(25);
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{
    /** Kept so the selection is cleared on dismissal, not on success. */
    ids: string[];
    failed: Failure[];
    missing: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function authHeaders(): Promise<HeadersInit> {
    const token = await getIdToken().catch(() => null);
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : { "Content-Type": "application/json" };
  }

  function reset() {
    setPlan(null);
    setSummary("");
    setTyped("");
    setProgress(null);
    setResult(null);
    setError(null);
    setAlreadyGone(0);
  }

  async function openDialog() {
    reset();
    setOpen(true);
    setLoading(true);
    try {
      const response = await fetch("/api/admin/products/delete", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ ids, preview: true }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        plan?: DeletionPlan;
        count?: number;
        missing?: string[];
        maxPerRequest?: number;
        summary?: { en: string; ar: string };
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("del.readError"));

      setPlan(data.plan ?? null);
      setCount(data.count ?? 0);
      setAlreadyGone(data.missing?.length ?? 0);
      if (data.maxPerRequest && data.maxPerRequest > 0) setPerRequest(data.maxPerRequest);
      setSummary(rtl ? (data.summary?.ar ?? "") : (data.summary?.en ?? ""));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : t("del.readError"));
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);

    const groups: string[][] = [];
    for (let i = 0; i < ids.length; i += perRequest) groups.push(ids.slice(i, i + perRequest));

    const deletedIds: string[] = [];
    const failed: Failure[] = [];
    let missing = 0;

    try {
      for (const group of groups) {
        setProgress({ done: deletedIds.length, total: count });

        const response = await fetch("/api/admin/products/delete", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ ids: group }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          failed?: Failure[];
          missing?: string[];
        };
        if (!response.ok || !data.ok) throw new Error(data.error ?? t("del.failed"));

        /*
         * What went is the group minus what the server named. Counting the
         * server's `deleted` number alone would leave the board holding rows
         * for products that are gone.
         */
        const refused = new Set((data.failed ?? []).map((entry) => entry.id));
        const gone = new Set(data.missing ?? []);
        for (const id of group) if (!refused.has(id) && !gone.has(id)) deletedIds.push(id);

        failed.push(...(data.failed ?? []));
        missing += data.missing?.length ?? 0;

        // A refusal stops the run — see the note at the top of this file.
        if (failed.length > 0) break;
      }

      setResult({ ids: deletedIds, failed, missing });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : t("del.failed"));
      // Whatever did go, still went. The report has to say so.
      if (deletedIds.length > 0) setResult({ ids: deletedIds, failed, missing });
    } finally {
      setProgress(null);
      setBusy(false);
      // The table behind the dialog reloads; the selection waits for dismissal.
      if (deletedIds.length > 0) router.refresh();
    }
  }

  /*
   * Closing is what clears the selection, not succeeding.
   *
   * The bar holding this control only exists while something is selected, so
   * clearing it the moment the deletion returned unmounted the dialog
   * mid-sentence — taking the report with it. On a clean run that lost a
   * confirmation; on a run with refusals it threw away the only list of which
   * products did not go and why.
   */
  function dismiss() {
    if (busy) return;
    setOpen(false);
    if (result && result.ids.length > 0) onDeleted(result.ids);
  }

  // Escape closes it, as it closes any dialog — and it is the way out that
  // does not involve moving the pointer past a red button.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const confirmed = typed.trim() === String(count) && count > 0;
  const finished = result !== null;

  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        className={cn(
          "border-alert/40 text-alert hover:bg-alert rounded-pill cursor-pointer border font-medium transition-colors hover:text-white",
          size === "sm" ? "px-2.5 py-1 text-[0.6875rem]" : "px-3 py-1.5 text-[0.75rem]",
        )}
        data-cursor="hover"
      >
        {t("del.selected").replace("{n}", String(ids.length))}
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] grid place-items-center p-4">
          <button
            type="button"
            aria-label={t("del.close")}
            onClick={dismiss}
            className="bg-ink/40 absolute inset-0 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("del.heading")}
            className="bg-paper-raised border-line rounded-xl shadow-float relative w-full max-w-md border p-5"
          >
            <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
              {t("del.heading")}
            </h3>

            {loading && (
              <p className="text-mist mt-3 text-[0.8125rem]">{t("del.working")}</p>
            )}

            {/* ---- what would happen, before it does ---- */}
            {!loading && !finished && plan && (
              <>
                <p className="text-ink-muted mt-3 text-[0.8125rem] leading-relaxed">{summary}</p>

                {plan.filesKept.length > 0 && (
                  <p className="text-mist mt-2 text-[0.75rem]">
                    {plan.filesKept.length === 1
                      ? t("del.keptOne")
                      : t("del.keptMany").replace("{n}", String(plan.filesKept.length))}
                  </p>
                )}

                {alreadyGone > 0 && (
                  <p className="text-mist mt-2 text-[0.75rem]">
                    {t("del.missing").replace("{n}", String(alreadyGone))}
                  </p>
                )}

                <p className="text-mist mt-3 text-[0.75rem] leading-relaxed">
                  {t("del.archiveInsteadMany")}
                </p>

                <label className="mt-4 block">
                  <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                    {t("del.typeCount")}{" "}
                    <span className="text-ink font-mono tabular-nums" dir="ltr">
                      {count}
                    </span>
                  </span>
                  <input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={busy}
                    className="border-line focus:border-alert bg-paper text-ink w-full rounded-md border px-3 py-2 font-mono text-[0.8125rem] tabular-nums outline-none"
                  />
                </label>

                {progress && (
                  <p role="status" className="text-ink-muted mt-3 text-[0.75rem] tabular-nums">
                    {t("del.progress")
                      .replace("{done}", String(progress.done))
                      .replace("{total}", String(progress.total))}
                  </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={dismiss}>
                    {t("del.cancel")}
                  </Button>
                  <button
                    type="button"
                    disabled={!confirmed || busy}
                    onClick={() => void run()}
                    className={cn(
                      "rounded-pill bg-alert cursor-pointer px-4 py-2 text-[0.8125rem] font-medium text-white",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                    data-cursor="hover"
                  >
                    {busy ? t("del.deleting") : t("del.confirm")}
                  </button>
                </div>
              </>
            )}

            {/* ---- what actually happened ---- */}
            {finished && result && (
              <>
                <p
                  role="status"
                  className={cn(
                    "mt-3 text-[0.8125rem] leading-relaxed",
                    result.failed.length > 0 ? "text-ink" : "text-mint",
                  )}
                >
                  {result.failed.length > 0
                    ? t("del.partial")
                        .replace("{ok}", String(result.ids.length))
                        .replace("{bad}", String(result.failed.length))
                    : t("del.allDone").replace("{n}", String(result.ids.length))}
                </p>

                {result.missing > 0 && (
                  <p className="text-mist mt-2 text-[0.75rem]">
                    {t("del.missing").replace("{n}", String(result.missing))}
                  </p>
                )}

                {/*
                  Each refusal by name and reason. A count on its own tells an
                  operator that something is wrong and nothing about what.
                */}
                {result.failed.length > 0 && (
                  <ul className="border-line mt-3 max-h-40 space-y-1.5 overflow-y-auto border-t pt-3">
                    {result.failed.map((failure) => (
                      <li key={failure.id} className="text-[0.75rem]">
                        <span className="text-ink">{failure.title}</span>
                        {failure.error && (
                          <span className="text-mist"> — {failure.error}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-5 flex justify-end">
                  <Button variant="secondary" size="sm" onClick={dismiss}>
                    {t("del.close")}
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
    </>
  );
}
