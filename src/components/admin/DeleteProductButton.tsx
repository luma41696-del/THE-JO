"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/Button";
import { useAdminLocale } from "./AdminLocale";
import type { DeletionPlan } from "@/lib/admin/delete-product";

/**
 * Deleting a product for good.
 *
 * The dialog asks the server what would happen *before* offering the button,
 * and shows the answer. "This also removes 14 reviews and takes it out of 3
 * wishlists" is the sentence that stops the wrong product being deleted — and
 * it has to be a counted number, not a warning about numbers in general.
 *
 * Typing the slug is the second guard. The row under the cursor is not always
 * the product somebody thinks it is, and this is not undoable by anyone.
 *
 * Archiving is deliberately offered in the same breath. Most of the time it is
 * what the merchant actually wants: the product leaves the shop, the orders
 * and the history stay, and it can come back.
 */
export function DeleteProductButton({
  productId,
  slug,
  title,
}: {
  productId: string;
  slug: string;
  title: string;
}) {
  const { rtl } = useAdminLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [summary, setSummary] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch(
        `/api/admin/products/delete?id=${encodeURIComponent(productId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        plan?: DeletionPlan;
        summary?: { en: string; ar: string };
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That could not be read.");
      setPlan(data.plan ?? null);
      setSummary(rtl ? (data.summary?.ar ?? "") : (data.summary?.en ?? ""));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "That could not be read.");
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch(
        `/api/admin/products/delete?id=${encodeURIComponent(productId)}`,
        { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");

      // Back to the catalogue: the page behind this dialog no longer exists.
      router.push("/admin/products");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "That did not work.");
      setBusy(false);
    }
  }

  const confirmed = typed.trim() === slug;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="text-mist hover:text-alert cursor-pointer text-[0.75rem] transition-colors"
        data-cursor="hover"
      >
        {rtl ? "احذف المنتج" : "Delete product"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] grid place-items-center p-4">
          <button
            type="button"
            aria-label={rtl ? "إغلاق" : "Close"}
            onClick={() => !busy && setOpen(false)}
            className="bg-ink/40 absolute inset-0 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={rtl ? "احذف المنتج" : "Delete product"}
            className="bg-paper-raised border-line rounded-xl shadow-float relative w-full max-w-md border p-5"
          >
            <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
              {rtl ? "احذف" : "Delete"} — {title}
            </h3>

            {loading ? (
              <p className="text-mist mt-3 text-[0.8125rem]">
                {rtl ? "يُحسب ما سيُحذف…" : "Working out what this removes…"}
              </p>
            ) : (
              plan && (
                <>
                  {/* Counted, not warned about in general. */}
                  <p className="text-ink-muted mt-3 text-[0.8125rem] leading-relaxed">{summary}</p>

                  {/*
                    Files another product still uses are kept, and said so.
                    A merchant who expects every image gone should find out
                    here, not by finding one still on a live page.
                  */}
                  {plan.filesKept.length > 0 && (
                    <p className="text-mist mt-2 text-[0.75rem]">
                      {rtl
                        ? `${plan.filesKept.length} صورة تبقى لأن منتجات أخرى تستخدمها.`
                        : plan.filesKept.length === 1
                          ? "1 image stays, because another product uses it."
                          : `${plan.filesKept.length} images stay, because other products use them.`}
                    </p>
                  )}

                  <p className="text-mist mt-3 text-[0.75rem] leading-relaxed">
                    {rtl
                      ? "الأرشفة تُخرجه من المتجر وتُبقي كل شيء، ويمكن التراجع عنها. الحذف لا يمكن التراجع عنه."
                      : "Archiving takes it out of the shop, keeps everything, and can be undone. Deleting cannot."}
                  </p>

                  <label className="mt-4 block">
                    <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                      {rtl ? "اكتب" : "Type"}{" "}
                      <span className="text-ink font-mono" dir="ltr">
                        {slug}
                      </span>{" "}
                      {rtl ? "للتأكيد" : "to confirm"}
                    </span>
                    <input
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      dir="ltr"
                      autoComplete="off"
                      className="border-line focus:border-alert bg-paper text-ink w-full rounded-md border px-3 py-2 font-mono text-[0.8125rem] outline-none"
                    />
                  </label>

                  <div className="mt-5 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                      {rtl ? "إلغاء" : "Cancel"}
                    </Button>
                    <button
                      type="button"
                      disabled={!confirmed || busy}
                      onClick={() => void remove()}
                      className={cn(
                        "rounded-pill bg-alert cursor-pointer px-4 py-2 text-[0.8125rem] font-medium text-white",
                        "disabled:cursor-not-allowed disabled:opacity-40",
                      )}
                      data-cursor="hover"
                    >
                      {busy
                        ? rtl
                          ? "يُحذف…"
                          : "Deleting…"
                        : rtl
                          ? "احذف نهائياً"
                          : "Delete for good"}
                    </button>
                  </div>
                </>
              )
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
