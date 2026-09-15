"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { transition } from "@/lib/motion";
import { getIdToken } from "@/lib/firebase/auth";
import { ACCEPT_ATTRIBUTE, uploadMerchandisingImage } from "@/lib/firebase/upload";
import { Button } from "@/components/ui/Button";
import type {
  Banner,
  BannerSlot,
  BannerStatus,
  BannerTextPosition,
  BannerTextTone,
  Locale,
  ProductImage,
} from "@/types";

/**
 * Banner editor, with the preview beside the fields.
 *
 * A banner is the one thing in the admin where the result cannot be imagined
 * from the form. "Text position: end-bottom, scrim 0.4, light text" describes
 * nothing; whether the headline is readable over *that* photograph is a
 * question only the picture can answer. So the preview is not a separate
 * "preview" button — it is always on, and it is the same layout maths the
 * storefront uses.
 */

const STORE_TZ = "Asia/Amman";

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

/** Store-time wall clock → epoch millis, correct across daylight saving. */
function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const guess = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(guess)) return null;
  const drift = new Date(`${toLocalInput(guess)}:00Z`).getTime() - guess;
  return guess - drift;
}

const PLACEMENT: Record<BannerTextPosition, string> = {
  "start-top": "items-start justify-start text-start",
  "start-middle": "items-center justify-start text-start",
  "start-bottom": "items-end justify-start text-start",
  "center-middle": "items-center justify-center text-center",
  "end-top": "items-start justify-end text-end",
  "end-middle": "items-center justify-end text-end",
  "end-bottom": "items-end justify-end text-end",
};

const POSITION_LABELS: Record<BannerTextPosition, string> = {
  "start-top": "Left, top",
  "start-middle": "Left, middle",
  "start-bottom": "Left, bottom",
  "center-middle": "Centred",
  "end-top": "Right, top",
  "end-middle": "Right, middle",
  "end-bottom": "Right, bottom",
};

const STATUS_LABELS: Record<BannerStatus, string> = {
  draft: "Draft — not on the site",
  active: "Live — on the site now",
  paused: "Paused — kept, not shown",
  archived: "Archived — closed for good",
};

type Draft = {
  slot: BannerSlot;
  eyebrowEn: string;
  eyebrowAr: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  ctaLabelEn: string;
  ctaLabelAr: string;
  ctaHref: string;
  media: ProductImage | null;
  mediaMobile: ProductImage | null;
  textPosition: BannerTextPosition;
  textTone: BannerTextTone;
  scrim: number;
  startsAt: string;
  endsAt: string;
  priority: number;
  status: BannerStatus;
};

const DAY = 86_400_000;

function toDraft(banner: Banner | null, slot: BannerSlot): Draft {
  if (!banner) {
    return {
      slot,
      eyebrowEn: "",
      eyebrowAr: "",
      titleEn: "",
      titleAr: "",
      bodyEn: "",
      bodyAr: "",
      ctaLabelEn: "",
      ctaLabelAr: "",
      ctaHref: "/shop",
      media: null,
      mediaMobile: null,
      textPosition: "start-middle",
      textTone: "light",
      scrim: 0.35,
      startsAt: toLocalInput(Date.now()),
      endsAt: toLocalInput(Date.now() + 30 * DAY),
      priority: 10,
      status: "draft",
    };
  }
  return {
    slot: banner.slot,
    eyebrowEn: banner.eyebrow?.en ?? "",
    eyebrowAr: banner.eyebrow?.ar ?? "",
    titleEn: banner.title.en,
    titleAr: banner.title.ar,
    bodyEn: banner.body?.en ?? "",
    bodyAr: banner.body?.ar ?? "",
    ctaLabelEn: banner.cta?.label.en ?? "",
    ctaLabelAr: banner.cta?.label.ar ?? "",
    ctaHref: banner.cta?.href ?? "",
    media: banner.media ?? null,
    mediaMobile: banner.mediaMobile ?? null,
    textPosition: banner.textPosition ?? "start-middle",
    textTone: banner.textTone ?? "light",
    scrim: banner.scrim ?? 0.35,
    startsAt: banner.startsAt ? toLocalInput(banner.startsAt) : "",
    endsAt: banner.endsAt ? toLocalInput(banner.endsAt) : "",
    priority: banner.priority ?? 0,
    status: banner.status ?? (banner.active ? "active" : "paused"),
  };
}

export interface BannerEditorProps {
  banner: Banner | null;
  defaultSlot?: BannerSlot;
  open: boolean;
  locale?: Locale;
  onClose: () => void;
  onSaved: () => void;
}

export function BannerEditor({
  banner,
  defaultSlot = "hero",
  open,
  locale = "en",
  onClose,
  onSaved,
}: BannerEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(banner, defaultSlot));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"desktop" | "mobile" | null>(null);
  const [previewMobile, setPreviewMobile] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<Locale>(locale);

  useEffect(() => {
    setDraft(toDraft(banner, defaultSlot));
    setError(null);
  }, [banner, defaultSlot, open]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const ar = previewLocale === "ar";
  const title = ar ? draft.titleAr : draft.titleEn;
  const eyebrow = ar ? draft.eyebrowAr : draft.eyebrowEn;
  const copy = ar ? draft.bodyAr : draft.bodyEn;
  const ctaLabel = ar ? draft.ctaLabelAr : draft.ctaLabelEn;
  const dark = draft.textTone !== "dark";

  const shownImage = previewMobile ? (draft.mediaMobile ?? draft.media) : draft.media;

  /*
   * A plain-language read-back of the schedule. "starts 2026-10-01T00:00"
   * tells a merchant nothing about whether the sale is live right now, which
   * is the only thing they actually want to know.
   */
  const scheduleNote = useMemo(() => {
    const start = fromLocalInput(draft.startsAt);
    const end = fromLocalInput(draft.endsAt);
    const now = Date.now();
    if (draft.status !== "active") return `Saved as ${draft.status}. Not on the site.`;
    if (start && start > now) return `Scheduled. Goes live ${draft.startsAt.replace("T", " ")} Amman time.`;
    if (end && end <= now) return "This window has already closed — it will not show.";
    if (end) return `Live now, until ${draft.endsAt.replace("T", " ")} Amman time.`;
    return "Live now, with no end date.";
  }, [draft.startsAt, draft.endsAt, draft.status]);

  async function pickImage(files: FileList | null, which: "desktop" | "mobile") {
    if (!files || files.length === 0) return;
    const file = files[0]!;
    setError(null);
    setUploading(which);
    try {
      const alt =
        window.prompt(
          "Describe this image for screen readers",
          draft.titleEn ? `${draft.titleEn} — campaign artwork` : "",
        ) ?? "";
      if (!alt.trim()) {
        setError("Every image needs alt text. Nothing was uploaded.");
        return;
      }
      // Banners live under `banners/` in Storage; the rules allow staff writes
      // there with the same raster-only restriction as product imagery.
      const uploaded = await uploadMerchandisingImage("banners", file, alt);
      set(which === "desktop" ? "media" : "mediaMobile", uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That image could not be uploaded.");
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    setError(null);
    if (!draft.titleEn.trim() || !draft.titleAr.trim()) {
      return setError("A title is required in both English and Arabic.");
    }

    setSaving(true);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/banners", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: banner?.id,
          slot: draft.slot,
          tone: "ink",
          eyebrow:
            draft.eyebrowEn.trim() || draft.eyebrowAr.trim()
              ? { en: draft.eyebrowEn.trim(), ar: draft.eyebrowAr.trim() }
              : null,
          title: { en: draft.titleEn.trim(), ar: draft.titleAr.trim() },
          body:
            draft.bodyEn.trim() || draft.bodyAr.trim()
              ? { en: draft.bodyEn.trim(), ar: draft.bodyAr.trim() }
              : null,
          cta:
            draft.ctaLabelEn.trim() || draft.ctaLabelAr.trim()
              ? {
                  label: { en: draft.ctaLabelEn.trim(), ar: draft.ctaLabelAr.trim() },
                  href: draft.ctaHref.trim(),
                }
              : null,
          media: draft.media,
          mediaMobile: draft.mediaMobile,
          textPosition: draft.textPosition,
          textTone: draft.textTone,
          scrim: draft.scrim,
          startsAt: fromLocalInput(draft.startsAt),
          endsAt: fromLocalInput(draft.endsAt),
          priority: draft.priority,
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
        setError("Validated, but not stored: Firebase Admin is not configured here.");
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The banner could not be saved.");
    } finally {
      setSaving(false);
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
            aria-label={banner ? "Edit banner" : "New banner"}
            className="bg-paper border-line fixed inset-y-0 end-0 z-[160] flex w-full max-w-3xl flex-col border-s"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={transition.drawer}
          >
            <header className="border-line flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-display text-ink text-lg font-semibold">
                {banner ? "Edit banner" : "New banner"}
              </h2>
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
              {/* ---- Preview ------------------------------------------- */}
              <div className="mb-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-mist text-[0.6875rem] tracking-[0.12em] uppercase">
                    Preview
                  </span>
                  <div className="flex gap-1">
                    <Toggle on={!previewMobile} onClick={() => setPreviewMobile(false)}>
                      Desktop
                    </Toggle>
                    <Toggle on={previewMobile} onClick={() => setPreviewMobile(true)}>
                      Phone
                    </Toggle>
                    <span className="mx-1" />
                    <Toggle on={previewLocale === "en"} onClick={() => setPreviewLocale("en")}>
                      EN
                    </Toggle>
                    <Toggle on={previewLocale === "ar"} onClick={() => setPreviewLocale("ar")}>
                      ع
                    </Toggle>
                  </div>
                </div>

                <div
                  dir={ar ? "rtl" : "ltr"}
                  className={cn(
                    "bg-paper-sunken rounded-lg relative mx-auto overflow-hidden",
                    previewMobile ? "aspect-[4/5] max-w-[16rem]" : "aspect-[21/9] w-full",
                  )}
                >
                  {shownImage ? (
                    <Image src={shownImage.url} alt="" fill sizes="600px" className="object-cover" />
                  ) : (
                    <div className="text-mist grid h-full place-items-center text-[0.75rem]">
                      No image yet
                    </div>
                  )}

                  <div
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-0",
                      dark
                        ? "from-ink via-ink/40 bg-gradient-to-t to-transparent"
                        : "bg-gradient-to-t from-white via-white/40 to-transparent",
                    )}
                    style={{ opacity: draft.scrim }}
                  />

                  <div
                    className={cn(
                      "absolute inset-0 flex p-4",
                      PLACEMENT[draft.textPosition],
                    )}
                  >
                    <div className="max-w-[80%]">
                      {eyebrow && (
                        <p
                          className={cn(
                            "mb-1 text-[0.5rem] tracking-[0.2em] uppercase",
                            dark ? "text-white/80" : "text-ink/70",
                          )}
                        >
                          {eyebrow}
                        </p>
                      )}
                      <p
                        className={cn(
                          "font-display text-balance whitespace-pre-line",
                          previewMobile ? "text-base" : "text-2xl",
                          "font-semibold tracking-tight",
                          dark ? "text-white" : "text-ink",
                        )}
                      >
                        {title || "Your headline"}
                      </p>
                      {copy && (
                        <p
                          className={cn(
                            "mt-1.5 text-[0.625rem]",
                            dark ? "text-white/85" : "text-ink-muted",
                          )}
                        >
                          {copy}
                        </p>
                      )}
                      {ctaLabel && (
                        <span
                          className={cn(
                            "rounded-pill mt-2.5 inline-block px-3 py-1 text-[0.625rem] font-semibold",
                            dark ? "bg-paper text-ink" : "bg-brand text-white",
                          )}
                        >
                          {ctaLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-mist mt-2 text-center text-[0.6875rem]">
                  {previewMobile && !draft.mediaMobile && draft.media
                    ? "No phone image — the desktop crop is being letterboxed."
                    : scheduleNote}
                </p>
              </div>

              {/* ---- Fields -------------------------------------------- */}
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Row label="Placement">
                    <select
                      value={draft.slot}
                      onChange={(e) => set("slot", e.target.value as BannerSlot)}
                      className={inputClass}
                    >
                      <option value="hero">Hero — the first screen</option>
                      <option value="promo-rail">Promo rail</option>
                      <option value="spotlight">Spotlight</option>
                      <option value="category-strip">Category strip</option>
                      <option value="announcement">Announcement bar</option>
                    </select>
                  </Row>
                  <Row label="Status">
                    <select
                      value={draft.status}
                      onChange={(e) => set("status", e.target.value as BannerStatus)}
                      className={inputClass}
                    >
                      {(Object.keys(STATUS_LABELS) as BannerStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </Row>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ImageSlot
                    label="Desktop image"
                    hint="Wide crop, 21:9 or thereabouts."
                    image={draft.media}
                    busy={uploading === "desktop"}
                    onPick={(files) => pickImage(files, "desktop")}
                    onClear={() => set("media", null)}
                  />
                  <ImageSlot
                    label="Phone image"
                    hint="Portrait. Without one, the desktop crop is letterboxed."
                    image={draft.mediaMobile}
                    busy={uploading === "mobile"}
                    onPick={(files) => pickImage(files, "mobile")}
                    onClear={() => set("mediaMobile", null)}
                  />
                </div>

                <Pair
                  label="Eyebrow"
                  en={draft.eyebrowEn}
                  ar={draft.eyebrowAr}
                  onEn={(v) => set("eyebrowEn", v)}
                  onAr={(v) => set("eyebrowAr", v)}
                />
                <Pair
                  label="Headline"
                  multiline
                  en={draft.titleEn}
                  ar={draft.titleAr}
                  onEn={(v) => set("titleEn", v)}
                  onAr={(v) => set("titleAr", v)}
                />
                <Pair
                  label="Body"
                  multiline
                  en={draft.bodyEn}
                  ar={draft.bodyAr}
                  onEn={(v) => set("bodyEn", v)}
                  onAr={(v) => set("bodyAr", v)}
                />
                <Pair
                  label="Button label"
                  en={draft.ctaLabelEn}
                  ar={draft.ctaLabelAr}
                  onEn={(v) => set("ctaLabelEn", v)}
                  onAr={(v) => set("ctaLabelAr", v)}
                />

                <Row label="Button link" hint="An internal path, beginning with /.">
                  <input
                    value={draft.ctaHref}
                    onChange={(e) => set("ctaHref", e.target.value)}
                    placeholder="/shop?category=outerwear"
                    className={cn(inputClass, "font-mono")}
                  />
                </Row>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Row label="Text position">
                    <select
                      value={draft.textPosition}
                      onChange={(e) => set("textPosition", e.target.value as BannerTextPosition)}
                      className={inputClass}
                    >
                      {(Object.keys(POSITION_LABELS) as BannerTextPosition[]).map((p) => (
                        <option key={p} value={p}>
                          {POSITION_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <Row label="Text colour">
                    <select
                      value={draft.textTone}
                      onChange={(e) => set("textTone", e.target.value as BannerTextTone)}
                      className={inputClass}
                    >
                      <option value="light">Light — for a dark photo</option>
                      <option value="dark">Dark — for a light photo</option>
                    </select>
                  </Row>
                  <Row label={`Dimming ${Math.round(draft.scrim * 100)}%`}>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draft.scrim}
                      onChange={(e) => set("scrim", Number(e.target.value))}
                      className="accent-brand w-full"
                    />
                  </Row>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Row label="Starts" hint="Amman time">
                    <input
                      type="datetime-local"
                      value={draft.startsAt}
                      onChange={(e) => set("startsAt", e.target.value)}
                      className={inputClass}
                    />
                  </Row>
                  <Row label="Ends" hint="Blank means no end">
                    <input
                      type="datetime-local"
                      value={draft.endsAt}
                      onChange={(e) => set("endsAt", e.target.value)}
                      className={inputClass}
                    />
                  </Row>
                  <Row label="Priority" hint="Higher shows first.">
                    <input
                      type="number"
                      min={0}
                      value={draft.priority}
                      onChange={(e) => set("priority", Number(e.target.value))}
                      className={inputClass}
                    />
                  </Row>
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
                {banner ? "Save changes" : "Create banner"}
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

/** English and Arabic side by side, so a missing translation is obvious. */
function Pair({
  label,
  en,
  ar,
  onEn,
  onAr,
  multiline = false,
}: {
  label: string;
  en: string;
  ar: string;
  onEn: (v: string) => void;
  onAr: (v: string) => void;
  multiline?: boolean;
}) {
  const Field = multiline ? "textarea" : "input";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Row label={`${label} (English)`}>
        <Field
          value={en}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onEn(e.target.value)
          }
          rows={multiline ? 2 : undefined}
          className={inputClass}
        />
      </Row>
      <Row label={`${label} (عربي)`}>
        <Field
          dir="rtl"
          value={ar}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onAr(e.target.value)
          }
          rows={multiline ? 2 : undefined}
          className={inputClass}
        />
      </Row>
    </div>
  );
}

function ImageSlot({
  label,
  hint,
  image,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  image: ProductImage | null;
  busy: boolean;
  onPick: (files: FileList | null) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{label}</span>
      <div className="flex items-center gap-2">
        <label
          className={cn(
            "border-line hover:border-brand text-mist hover:text-brand grid h-20 w-28 shrink-0 place-items-center rounded-md border border-dashed text-[0.6875rem]",
            busy ? "cursor-wait opacity-60" : "cursor-pointer",
          )}
        >
          {image ? (
            <span className="relative h-full w-full overflow-hidden rounded-md">
              <Image src={image.url} alt="" fill sizes="112px" className="object-cover" />
            </span>
          ) : (
            <span>{busy ? "…" : "Upload"}</span>
          )}
          <input
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            disabled={busy}
            onChange={(e) => onPick(e.target.files)}
            className="sr-only"
          />
        </label>
        {image && (
          <button
            type="button"
            onClick={onClear}
            className="text-alert cursor-pointer text-[0.75rem]"
          >
            Remove
          </button>
        )}
      </div>
      <span className="text-mist mt-1 block text-[0.6875rem]">{hint}</span>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-pill cursor-pointer px-2.5 py-1 text-[0.6875rem] transition-colors",
        on ? "bg-ink text-white" : "text-ink-muted hover:bg-paper-sunken",
      )}
    >
      {children}
    </button>
  );
}
