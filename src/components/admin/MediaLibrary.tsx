"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";

import { getIdToken } from "@/lib/firebase/auth";
import { humanBytes, type MediaAsset } from "@/lib/media";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ProductImage } from "@/types";
import { useAdminLocale } from "./AdminLocale";

/**
 * Every image the shop has uploaded, to pick from.
 *
 * The reason this exists: the same photograph — a size chart, a fabric swatch,
 * a campaign shot — belongs on several products, and without a library the
 * only way to put it on the second one is to upload it again. Two copies of
 * one file then drift apart: one gets its alt text fixed, the other does not,
 * and deleting either looks safe.
 *
 * Reuse copies the file's **URL and its alt text** onto the product. It does
 * not copy the file. That is the point — one object, one description, however
 * many products show it.
 */

export interface LibraryAsset extends MediaAsset {
  id: string;
  /** Products that already show this file. Counted server-side, never stored. */
  usedBy: string[];
  usageCount: number;
}

export function MediaLibrary({
  open,
  onClose,
  onPick,
  /** URLs already on the product being edited, shown as already-added. */
  alreadyUsed = [],
  /** Excluded from the usage count when deleting — see the media route. */
  ignoreProductId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (images: ProductImage[]) => void;
  alreadyUsed?: string[];
  ignoreProductId?: string;
}) {
  const { t, locale } = useAdminLocale();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(
    async (search: string) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken().catch(() => null);
        const response = await fetch(`/api/admin/media?q=${encodeURIComponent(search)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await response.json()) as { ok?: boolean; assets?: LibraryAsset[]; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? t("media.loadFailed"));
        setAssets(data.assets ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t("media.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  /*
   * Reloaded on open rather than cached across opens. Somebody else may have
   * uploaded since, and a picker showing a stale library is a picker that
   * makes people upload a duplicate.
   */
  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setConfirmDelete(null);
    void load(query);
    // The query is debounced separately below; opening reloads whatever is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void load(query), 250);
    return () => clearTimeout(timer);
  }, [query, open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function toggle(url: string) {
    setPicked((current) =>
      current.includes(url) ? current.filter((u) => u !== url) : [...current, url],
    );
  }

  function addPicked() {
    const chosen = picked
      .map((url) => assets.find((asset) => asset.url === url))
      .filter((asset): asset is LibraryAsset => Boolean(asset))
      .map<ProductImage>((asset) => ({
        url: asset.url,
        // The alt text travels with the file. Re-describing the same
        // photograph on every product is how the descriptions drift apart.
        alt: asset.alt,
        width: asset.width,
        height: asset.height,
      }));
    onPick(chosen);
    onClose();
  }

  /**
   * Delete a file from Storage for good.
   *
   * The server refuses while any product still shows it and answers with which
   * ones. That refusal is surfaced here as the message, not as a generic
   * failure — "three products still use this image" tells the merchant what to
   * do next; "delete failed" does not.
   */
  async function remove(url: string) {
    setDeleting(url);
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/media", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url, ignoreProductId }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        errorAr?: string;
        usedBy?: string[];
      };
      if (!response.ok || !data.ok) {
        throw new Error((locale === "ar" ? data.errorAr : data.error) ?? t("media.deleteFailed"));
      }
      setAssets((current) => current.filter((asset) => asset.url !== url));
      setPicked((current) => current.filter((u) => u !== url));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("media.deleteFailed"));
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="bg-ink/40 fixed inset-0 z-[150]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label={t("media.title")}
            className="bg-paper border-line fixed inset-y-0 end-0 z-[160] flex w-full max-w-2xl flex-col border-s"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={transition.drawer}
          >
            <header className="border-line flex items-center justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-display text-ink text-lg font-semibold">{t("media.title")}</h2>
                <p className="text-mist mt-0.5 text-[0.75rem]">{t("media.subtitle")}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="text-mist hover:text-ink cursor-pointer p-2 transition-colors"
                data-cursor="hover"
              >
                ✕
              </button>
            </header>

            <div className="border-line border-b px-5 py-3">
              <label className="block">
                <span className="sr-only">{t("media.searchLabel")}</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("media.searchPlaceholder")}
                  className="border-line focus:border-brand bg-paper-raised text-ink placeholder:text-mist w-full rounded-pill border px-4 py-2 text-[0.8125rem] outline-none transition-colors"
                />
              </label>
            </div>

            {error && (
              <p role="alert" className="text-alert px-5 py-3 text-[0.8125rem]">
                {error}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loading && assets.length === 0 && (
                <p className="text-mist py-10 text-center text-[0.8125rem]">{t("common.loading")}</p>
              )}

              {!loading && assets.length === 0 && (
                <p className="text-mist py-10 text-center text-[0.8125rem]">
                  {query ? t("common.noMatch") : t("media.empty")}
                </p>
              )}

              <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
                {assets.map((asset) => {
                  const chosen = picked.includes(asset.url);
                  const onProduct = alreadyUsed.includes(asset.url);
                  return (
                    <li key={asset.id}>
                      <button
                        type="button"
                        onClick={() => !onProduct && toggle(asset.url)}
                        aria-pressed={chosen}
                        disabled={onProduct}
                        className={cn(
                          "group relative block aspect-[3/4] w-full overflow-hidden rounded-md border-2 transition-colors",
                          chosen ? "border-brand" : "border-transparent",
                          onProduct ? "cursor-default opacity-45" : "cursor-pointer",
                        )}
                        data-cursor={onProduct ? undefined : "hover"}
                      >
                        <Image
                          src={asset.url}
                          alt={asset.alt}
                          fill
                          sizes="120px"
                          className="object-cover"
                        />

                        {onProduct && (
                          <span className="bg-ink/70 absolute inset-x-0 top-0 px-1.5 py-1 text-[0.5625rem] font-semibold tracking-wide text-white uppercase">
                            {t("media.onThisProduct")}
                          </span>
                        )}

                        {chosen && !onProduct && (
                          <span className="bg-brand absolute end-1 top-1 grid h-5 w-5 place-items-center rounded-full text-[0.625rem] font-bold text-white">
                            ✓
                          </span>
                        )}

                        {/* The count is the thing that makes deleting safe to
                            reason about, so it is on the card, not behind a
                            hover. */}
                        {asset.usageCount > 0 && (
                          <span className="bg-ink/70 absolute inset-x-0 bottom-0 px-1.5 py-1 text-start text-[0.5625rem] text-white">
                            {asset.usageCount === 1
                              ? t("media.usedOnce")
                              : t("media.usedMany").replace("{n}", String(asset.usageCount))}
                          </span>
                        )}
                      </button>

                      <p className="text-mist mt-1 truncate text-[0.625rem]" title={asset.filename}>
                        {asset.filename}
                      </p>
                      <p className="text-mist flex items-center justify-between gap-1 text-[0.5625rem] tabular-nums">
                        <span>
                          {asset.width}×{asset.height}
                          {asset.bytes ? ` · ${humanBytes(asset.bytes)}` : ""}
                        </span>

                        {/*
                          Two clicks to delete, and the second one says what is
                          about to happen. No `window.confirm`: it cannot say
                          which file, and a merchant who has clicked ✕ on the
                          wrong thumbnail reads "Are you sure?" and presses OK.
                        */}
                        {confirmDelete === asset.url ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void remove(asset.url)}
                              disabled={deleting === asset.url}
                              className="text-alert cursor-pointer font-semibold disabled:opacity-40"
                              data-cursor="hover"
                            >
                              {deleting === asset.url ? t("media.deleting") : t("media.reallyDelete")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              className="hover:text-ink cursor-pointer"
                              data-cursor="hover"
                            >
                              {t("common.cancel")}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(asset.url)}
                            className="hover:text-alert cursor-pointer"
                            aria-label={`${t("media.delete")} ${asset.filename}`}
                            data-cursor="hover"
                          >
                            {t("media.delete")}
                          </button>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>

            <footer className="border-line flex items-center justify-between gap-3 border-t px-5 py-4">
              <p className="text-mist text-[0.75rem] tabular-nums">
                {picked.length > 0
                  ? t("media.selected").replace("{n}", String(picked.length))
                  : t("media.pickHint")}
              </p>
              <button
                type="button"
                onClick={addPicked}
                disabled={picked.length === 0}
                className="bg-ink rounded-pill cursor-pointer px-4 py-2 text-[0.8125rem] font-medium text-white transition-opacity disabled:opacity-40"
                data-cursor="hover"
              >
                {t("media.addSelected")}
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
