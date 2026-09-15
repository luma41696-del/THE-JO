"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { transition } from "@/lib/motion";
import { getIdToken } from "@/lib/firebase/auth";
import { offerStatus } from "@/lib/offers";
import { Button } from "@/components/ui/Button";
import type { Category, Offer, OfferStatus, OfferType, Product } from "@/types";

/**
 * Coupon editor.
 *
 * A side drawer rather than its own route: a merchant creating a campaign is
 * comparing it against the codes already running, and a full page navigation
 * throws that context away.
 *
 * Dates are entered and displayed in **Amman time**. `datetime-input` values
 * are naive local strings, so a merchant on a laptop set to another timezone
 * would otherwise schedule a sale hours off from the store's own clock and
 * have no way to see it. The conversion is explicit in both directions.
 */

/** The store operates on Amman time regardless of where the admin is sitting. */
const STORE_TZ = "Asia/Amman";

/** Epoch millis → the `YYYY-MM-DDTHH:mm` an input expects, in store time. */
function toLocalInput(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * The inverse: a store-time wall clock string → epoch millis.
 *
 * Amman's offset changes with daylight saving, so it cannot be hard-coded.
 * The offset is measured *at that instant* by formatting a first guess back
 * into store time and correcting by the difference — which stays right across
 * the spring and autumn transitions.
 */
function fromLocalInput(value: string): number {
  if (!value) return Date.now();
  const guess = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(guess)) return Date.now();
  const rendered = toLocalInput(guess);
  const drift = new Date(`${rendered}:00Z`).getTime() - guess;
  return guess - drift;
}

const STATUS_LABELS: Record<OfferStatus, string> = {
  draft: "Draft — not usable yet",
  active: "Active — customers can use it",
  paused: "Paused — kept, but refused",
  archived: "Archived — closed for good",
};

export interface OfferEditorProps {
  offer: Offer | null;
  categories: Category[];
  products: Product[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type Draft = {
  code: string;
  type: OfferType;
  value: number;
  maxDiscount: number | "";
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  minSubtotal: number | "";
  appliesToCategoryIds: string[];
  appliesToProductIds: string[];
  excludesCategoryIds: string[];
  excludesProductIds: string[];
  startsAt: string;
  endsAt: string;
  usageLimit: number | "";
  perUserLimit: number | "";
  assignedUid: string;
  firstOrderOnly: boolean;
  stackable: boolean;
  status: OfferStatus;
};

const DAY = 86_400_000;

function toDraft(offer: Offer | null): Draft {
  if (!offer) {
    const now = Date.now();
    return {
      code: "",
      type: "percentage",
      value: 10,
      maxDiscount: "",
      titleEn: "",
      titleAr: "",
      descriptionEn: "",
      descriptionAr: "",
      minSubtotal: "",
      appliesToCategoryIds: [],
      appliesToProductIds: [],
      excludesCategoryIds: [],
      excludesProductIds: [],
      startsAt: toLocalInput(now),
      endsAt: toLocalInput(now + 30 * DAY),
      usageLimit: "",
      perUserLimit: 1,
      assignedUid: "",
      firstOrderOnly: false,
      stackable: false,
      status: "draft",
    };
  }

  return {
    code: offer.code,
    type: offer.type,
    value: offer.value,
    maxDiscount: offer.maxDiscount ?? "",
    titleEn: offer.title.en,
    titleAr: offer.title.ar,
    descriptionEn: offer.description?.en ?? "",
    descriptionAr: offer.description?.ar ?? "",
    minSubtotal: offer.minSubtotal ?? "",
    appliesToCategoryIds: offer.appliesToCategoryIds ?? [],
    appliesToProductIds: offer.appliesToProductIds ?? [],
    excludesCategoryIds: offer.excludesCategoryIds ?? [],
    excludesProductIds: offer.excludesProductIds ?? [],
    startsAt: toLocalInput(offer.startsAt),
    endsAt: toLocalInput(offer.endsAt),
    usageLimit: offer.usageLimit ?? "",
    perUserLimit: offer.perUserLimit ?? "",
    assignedUid: offer.assignedUid ?? "",
    firstOrderOnly: offer.firstOrderOnly ?? false,
    stackable: offer.stackable ?? false,
    status: offerStatus(offer),
  };
}

export function OfferEditor({
  offer,
  categories,
  products,
  open,
  onClose,
  onSaved,
}: OfferEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(offer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever a different coupon is opened; otherwise the drawer would
  // show the previous one's values over the new one's.
  useEffect(() => {
    setDraft(toDraft(offer));
    setError(null);
  }, [offer, open]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const isPercentage = draft.type === "percentage";
  const isFree = draft.type === "free-shipping";

  /*
   * A live preview of the rules, in the sentence a customer would hear. A
   * coupon is a set of conditions that are easy to get subtly wrong — "20%
   * off, minimum 0, limit blank" reads very differently as a paragraph than as
   * six fields — so the paragraph is shown while it is being written.
   */
  const summary = useMemo(() => {
    const bits: string[] = [];
    if (isFree) bits.push("Free delivery");
    else if (isPercentage) {
      bits.push(`${draft.value}% off`);
      if (draft.maxDiscount !== "") bits.push(`up to ${draft.maxDiscount} JOD`);
    } else bits.push(`${draft.value} JOD off`);

    const scope = draft.appliesToCategoryIds.length + draft.appliesToProductIds.length;
    bits.push(scope === 0 ? "on everything" : `on ${scope} selected ${scope === 1 ? "group" : "groups"}`);

    const excluded = draft.excludesCategoryIds.length + draft.excludesProductIds.length;
    if (excluded > 0) bits.push(`excluding ${excluded}`);
    if (draft.minSubtotal !== "") bits.push(`over ${draft.minSubtotal} JOD`);
    if (draft.firstOrderOnly) bits.push("first order only");
    if (draft.assignedUid) bits.push("one account only");
    if (draft.perUserLimit !== "") bits.push(`${draft.perUserLimit} per customer`);
    if (draft.usageLimit !== "") bits.push(`${draft.usageLimit} in total`);
    bits.push(draft.stackable ? "stacks with sales" : "does not stack with sales");
    return bits.join(" · ");
  }, [draft, isFree, isPercentage]);

  async function save() {
    setError(null);

    if (!draft.code.trim()) return setError("A code is required.");
    if (!draft.titleEn.trim() || !draft.titleAr.trim()) {
      return setError("A title is required in both English and Arabic.");
    }

    setSaving(true);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/offers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: offer?.id,
          code: draft.code,
          type: draft.type,
          value: draft.value,
          maxDiscount: draft.maxDiscount === "" ? null : draft.maxDiscount,
          title: { en: draft.titleEn.trim(), ar: draft.titleAr.trim() },
          description:
            draft.descriptionEn.trim() || draft.descriptionAr.trim()
              ? { en: draft.descriptionEn.trim(), ar: draft.descriptionAr.trim() }
              : null,
          minSubtotal: draft.minSubtotal === "" ? null : draft.minSubtotal,
          appliesToCategoryIds: draft.appliesToCategoryIds,
          appliesToProductIds: draft.appliesToProductIds,
          excludesCategoryIds: draft.excludesCategoryIds,
          excludesProductIds: draft.excludesProductIds,
          startsAt: fromLocalInput(draft.startsAt),
          endsAt: fromLocalInput(draft.endsAt),
          usageLimit: draft.usageLimit === "" ? null : draft.usageLimit,
          perUserLimit: draft.perUserLimit === "" ? null : draft.perUserLimit,
          assignedUid: draft.assignedUid.trim() || null,
          firstOrderOnly: draft.firstOrderOnly,
          stackable: draft.stackable,
          status: draft.status,
        }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        persisted?: boolean;
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Save failed");

      if (data.persisted === false) {
        setError(
          "Validated, but not stored: Firebase Admin is not configured in this environment.",
        );
        setSaving(false);
        return;
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The coupon could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[150] bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label={offer ? `Edit ${offer.code}` : "New coupon"}
            className="bg-paper border-line fixed inset-y-0 end-0 z-[160] flex w-full max-w-lg flex-col border-s"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={transition.drawer}
          >
            <header className="border-line flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-display text-ink text-lg font-semibold">
                  {offer ? `Edit ${offer.code}` : "New coupon"}
                </h2>
                {offer && (
                  <p className="text-mist mt-0.5 text-[0.75rem] tabular-nums">
                    {offer.usageCount.toLocaleString("en-GB")} redemptions so far
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-mist hover:text-ink cursor-pointer p-2 transition-colors"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="grid gap-4">
                <Row label="Code" hint="Upper-case, no spaces. This is what customers type.">
                  <input
                    value={draft.code}
                    onChange={(e) => set("code", e.target.value.toUpperCase())}
                    placeholder="SUMMER20"
                    className={inputClass}
                  />
                </Row>

                <Row label="Reward">
                  <select
                    value={draft.type}
                    onChange={(e) => set("type", e.target.value as OfferType)}
                    className={inputClass}
                  >
                    <option value="percentage">Percentage off</option>
                    <option value="fixed">Fixed amount off</option>
                    <option value="free-shipping">Free delivery</option>
                  </select>
                </Row>

                {!isFree && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Row label={isPercentage ? "Percent off" : "Amount off (JOD)"}>
                      <input
                        type="number"
                        min={0}
                        step={isPercentage ? 1 : 0.001}
                        value={draft.value}
                        onChange={(e) => set("value", Number(e.target.value))}
                        className={inputClass}
                      />
                    </Row>
                    {isPercentage && (
                      <Row
                        label="Cap (JOD)"
                        hint="Blank means uncapped — rarely what you want."
                      >
                        <input
                          type="number"
                          min={0}
                          step={0.001}
                          value={draft.maxDiscount}
                          onChange={(e) =>
                            set("maxDiscount", e.target.value === "" ? "" : Number(e.target.value))
                          }
                          className={inputClass}
                        />
                      </Row>
                    )}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Row label="Title (English)">
                    <input
                      value={draft.titleEn}
                      onChange={(e) => set("titleEn", e.target.value)}
                      className={inputClass}
                    />
                  </Row>
                  <Row label="العنوان (عربي)">
                    <input
                      dir="rtl"
                      value={draft.titleAr}
                      onChange={(e) => set("titleAr", e.target.value)}
                      className={inputClass}
                    />
                  </Row>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Row label="Starts" hint="Amman time">
                    <input
                      type="datetime-local"
                      value={draft.startsAt}
                      onChange={(e) => set("startsAt", e.target.value)}
                      className={inputClass}
                    />
                  </Row>
                  <Row label="Ends" hint="Amman time">
                    <input
                      type="datetime-local"
                      value={draft.endsAt}
                      onChange={(e) => set("endsAt", e.target.value)}
                      className={inputClass}
                    />
                  </Row>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Row label="Min spend">
                    <input
                      type="number"
                      min={0}
                      step={0.001}
                      value={draft.minSubtotal}
                      onChange={(e) =>
                        set("minSubtotal", e.target.value === "" ? "" : Number(e.target.value))
                      }
                      className={inputClass}
                    />
                  </Row>
                  <Row label="Total limit">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.usageLimit}
                      onChange={(e) =>
                        set("usageLimit", e.target.value === "" ? "" : Number(e.target.value))
                      }
                      className={inputClass}
                    />
                  </Row>
                  <Row label="Per customer">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.perUserLimit}
                      onChange={(e) =>
                        set("perUserLimit", e.target.value === "" ? "" : Number(e.target.value))
                      }
                      className={inputClass}
                    />
                  </Row>
                </div>

                <MultiSelect
                  label="Applies to categories"
                  hint="Empty means the whole catalogue."
                  options={categories.map((c) => ({
                    id: c.id,
                    label: `${"— ".repeat(c.depth)}${c.name.en}`,
                  }))}
                  selected={draft.appliesToCategoryIds}
                  onChange={(v) => set("appliesToCategoryIds", v)}
                />

                <MultiSelect
                  label="Excluded categories"
                  hint="Wins over the includes above."
                  options={categories.map((c) => ({
                    id: c.id,
                    label: `${"— ".repeat(c.depth)}${c.name.en}`,
                  }))}
                  selected={draft.excludesCategoryIds}
                  onChange={(v) => set("excludesCategoryIds", v)}
                />

                <MultiSelect
                  label="Excluded products"
                  options={products.map((p) => ({ id: p.id, label: p.title.en }))}
                  selected={draft.excludesProductIds}
                  onChange={(v) => set("excludesProductIds", v)}
                />

                <Row
                  label="Restrict to one account (uid)"
                  hint="For a personal gift or apology code. Leave blank for everyone."
                >
                  <input
                    value={draft.assignedUid}
                    onChange={(e) => set("assignedUid", e.target.value)}
                    className={cn(inputClass, "font-mono")}
                  />
                </Row>

                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={draft.firstOrderOnly}
                    onChange={(e) => set("firstOrderOnly", e.target.checked)}
                    className="accent-brand mt-0.5"
                  />
                  <span className="text-ink text-[0.8125rem]">
                    First order only
                    <span className="text-mist block text-[0.6875rem]">
                      Refused once the account has a completed order.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={draft.stackable}
                    onChange={(e) => set("stackable", e.target.checked)}
                    className="accent-brand mt-0.5"
                  />
                  <span className="text-ink text-[0.8125rem]">
                    May combine with sale prices
                    <span className="text-mist block text-[0.6875rem]">
                      Off by default. Stacking a code on a sale is how 20% and 30% become 50%.
                    </span>
                  </span>
                </label>

                <Row label="Status">
                  <select
                    value={draft.status}
                    onChange={(e) => set("status", e.target.value as OfferStatus)}
                    className={inputClass}
                  >
                    {(Object.keys(STATUS_LABELS) as OfferStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Row>

                <div className="bg-paper-sunken rounded-md p-3.5">
                  <p className="text-mist text-[0.6875rem] tracking-[0.12em] uppercase">
                    In plain words
                  </p>
                  <p className="text-ink mt-1.5 text-[0.8125rem]">{summary}</p>
                </div>

                {error && (
                  <p role="alert" className="text-alert text-[0.8125rem]">
                    {error}
                  </p>
                )}
              </div>
            </div>

            <footer className="border-line flex items-center justify-end gap-3 border-t px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="text-smoke hover:text-ink cursor-pointer text-[0.8125rem]"
              >
                Cancel
              </button>
              <Button variant="brand" size="md" loading={saving} onClick={save}>
                {offer ? "Save changes" : "Create coupon"}
              </Button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* -------------------------------------------------------------------------- */

const inputClass =
  "border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{label}</span>
      {children}
      {hint && <span className="text-mist mt-1 block text-[0.6875rem]">{hint}</span>}
    </label>
  );
}

/**
 * A checkbox list, not a native multi-select.
 *
 * Native `<select multiple>` requires ctrl-clicking to add a second item and
 * silently clears the rest when someone clicks without it — a merchant loses a
 * carefully built exclusion list to one stray click and never learns why.
 */
function MultiSelect({
  label,
  hint,
  options,
  selected,
  onChange,
}: {
  label: string;
  hint?: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () =>
      query.trim()
        ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
        : options,
    [options, query],
  );

  return (
    <div>
      <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
        {label}
        {selected.length > 0 && (
          <span className="text-brand ms-2 tabular-nums">{selected.length} selected</span>
        )}
      </span>

      {options.length > 8 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className={cn(inputClass, "mb-2")}
        />
      )}

      <div className="border-line max-h-40 overflow-y-auto rounded-md border p-2">
        {shown.length === 0 ? (
          <p className="text-mist p-2 text-[0.75rem]">Nothing matches.</p>
        ) : (
          shown.map((option) => {
            const on = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className="hover:bg-paper-sunken flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    onChange(
                      on ? selected.filter((id) => id !== option.id) : [...selected, option.id],
                    )
                  }
                  className="accent-brand"
                />
                <span className="text-ink truncate text-[0.8125rem]">{option.label}</span>
              </label>
            );
          })
        )}
      </div>
      {hint && <span className="text-mist mt-1 block text-[0.6875rem]">{hint}</span>}
    </div>
  );
}
