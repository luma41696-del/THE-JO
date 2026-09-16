"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { storagePathFromUrl } from "@/lib/media";
import { TryOnPanel } from "./TryOnPanel";
import { errorMessage, readJson } from "@/lib/errors";
import { useAuth } from "@/components/providers/AuthProvider";
import { useConsent } from "@/lib/analytics/consent";
import { Button } from "@/components/ui/Button";
import { Link } from "@/components/ui/Link";
import {
  PHOTO_GUIDANCE,
  PHOTO_ISSUE_TEXT,
  checkPhoto,
  dataUrlToFile,
  type PhotoCheck,
} from "@/lib/fitting/photo";
import { isPlausible, profileCompleteness } from "@/lib/fitting/avatar";
import type { FitProfile, Locale } from "@/types";

/**
 * Measurements, and the optional photo.
 *
 * The measurements come first and the photo second, because that is the honest
 * order: the avatar is built from the numbers. A photo-first flow would imply
 * the figure is derived from the image, which it is not — and the panel says
 * so where the upload sits, not in a footnote.
 *
 * Fitting-room consent is asked **here**, at the point a photograph would
 * leave the device, rather than in the site-wide banner. A permission for body
 * images collected while someone was dismissing a cookie notice is not a
 * permission anyone gave.
 */

export interface BodyPanelProps {
  profile: FitProfile | null;
  onChange: (profile: FitProfile) => void;
  locale?: Locale;
  /** True when a try-on provider is configured server-side. */
  providerConfigured?: boolean;
  providerMissing?: string[];
  /** The piece currently in focus, for the try-on control below. */
  tryOnProductId?: string | null;
}

const FIELDS = [
  { key: "heightCm", en: "Height", ar: "الطول", min: 120, max: 220 },
  { key: "chestCm", en: "Chest", ar: "الصدر", min: 60, max: 160 },
  { key: "waistCm", en: "Waist", ar: "الخصر", min: 50, max: 160 },
  { key: "hipCm", en: "Hip", ar: "الورك", min: 60, max: 170 },
] as const;

const FIT_OPTIONS = [
  { id: "slim", en: "Close", ar: "ضيّقة" },
  { id: "regular", en: "Regular", ar: "عادية" },
  { id: "relaxed", en: "Roomy", ar: "واسعة" },
] as const satisfies readonly { id: NonNullable<FitProfile["preferredFit"]>; en: string; ar: string }[];

export function BodyPanel({
  profile,
  onChange,
  locale = "en",
  providerConfigured = false,
  providerMissing = [],
  tryOnProductId = null,
}: BodyPanelProps) {
  const rtl = locale === "ar";
  const uid = useAuth().user?.uid ?? null;

  const fittingConsent = useConsent((s) => s.fittingRoom);
  const setConsent = useConsent((s) => s.set);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [check, setCheck] = useState<PhotoCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [storedPhoto, setStoredPhoto] = useState<string | null>(null);

  const completeness = profileCompleteness(profile);
  const saveTimer = useRef<number | null>(null);

  /**
   * Apply a change and schedule the save.
   *
   * Debounced. A slider that wrote on every pixel would be a request per
   * frame; a save that only happened on blur would lose the change when
   * someone closes the tab thinking.
   */
  function commit(patch: Partial<FitProfile>) {
    const next: FitProfile = { ...(profile ?? {}), ...patch, updatedAt: Date.now() };
    onChange(next);

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(next), 900);
  }

  function setField(key: (typeof FIELDS)[number]["key"], raw: string) {
    commit({ [key]: raw === "" ? undefined : Number(raw) });
  }

  const save = useCallback(
    async (next: FitProfile) => {
      if (!uid) return;
      setSaving(true);
      setError(null);
      try {
        const token = await getIdToken().catch(() => null);
        const response = await fetch("/api/fitting/profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ fitProfile: next }),
        });
        await readJson(response);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
      } catch (err) {
        setError(
          errorMessage(err, locale, {
            en: "Your measurements could not be saved.",
            ar: "تعذّر حفظ قياساتك.",
          }),
        );
      } finally {
        setSaving(false);
      }
    },
    // `locale` matters: the callback composes the failure message, and a
    // stale closure would report it in the language the page opened in.
    [uid, locale],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  /**
   * Erase the measurements, locally and on the server.
   *
   * The pending debounced save is cancelled first — without that, a delete
   * followed by the in-flight timer would write the old numbers straight back
   * a moment later, and the customer would watch their data reappear.
   */
  async function forget() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    onChange({ updatedAt: Date.now() });
    if (!uid) return;

    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/fitting/profile?target=measurements", {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      await readJson(response);
    } catch (err) {
      setError(
        errorMessage(err, locale, {
          en: "Your measurements could not be deleted.",
          ar: "تعذّر حذف قياساتك.",
        }),
      );
    }
  }

  async function pickPhoto(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setChecking(true);
    try {
      const result = await checkPhoto(files[0]!);
      setCheck(result);
    } catch {
      setError(rtl ? "تعذّر قراءة الصورة." : "That photo could not be read.");
    } finally {
      setChecking(false);
    }
  }

  async function uploadPhoto() {
    if (!check?.preview || !uid) return;
    setUploading(true);
    setError(null);
    try {
      const { uploadFittingPhoto } = await import("@/lib/firebase/upload");
      const file = await dataUrlToFile(check.preview, "fitting.jpg");
      const url = await uploadFittingPhoto(uid, file);
      setStoredPhoto(url);
      setCheck(null);
    } catch (err) {
      setError(
        errorMessage(err, locale, {
          en: "That photo could not be saved.",
          ar: "تعذّر حفظ الصورة.",
        }),
      );
    } finally {
      setUploading(false);
    }
  }

  /**
   * Tell the server what was agreed to.
   *
   * The checkbox alone lives in this browser, and a flag the server cannot see
   * is one that cannot gate anything: the try-on costs money per call and runs
   * server-side, so the consent it checks has to be recorded where that check
   * happens. Withdrawal is sent too — see the route, which records "no"
   * rather than deleting the field, because a missing record cannot tell
   * somebody who declined from somebody never asked.
   *
   * Best effort on purpose. The local flag is what this panel renders from,
   * and a failed write here must not leave the checkbox disagreeing with
   * itself; the server simply keeps refusing until a later write lands.
   */
  async function recordConsent(granted: boolean) {
    if (!uid) return;
    try {
      const token = await getIdToken().catch(() => null);
      await fetch("/api/fitting/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ tryOnConsent: granted }),
      });
    } catch {
      /* Left for the next toggle or the next save. */
    }
  }

  async function deletePhoto() {
    if (!uid) return;
    try {
      const { deleteFittingPhotos } = await import("@/lib/firebase/upload");
      await deleteFittingPhotos(uid);
      setStoredPhoto(null);
      setCheck(null);
    } catch (err) {
      setError(
        errorMessage(err, locale, {
          en: "That photo could not be removed.",
          ar: "تعذّر حذف الصورة.",
        }),
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* ---- Measurements ---------------------------------------------- */}
      <section>
        <h3 className="font-display text-ink text-[1.0625rem] font-semibold">
          {rtl ? "قياساتك" : "Your measurements"}
        </h3>
        <p className="text-smoke mt-1 text-[0.8125rem]">
          {rtl
            ? "منها يُبنى المجسم، ومنها يُحسب اقتراح المقاس."
            : "The figure is built from these, and so is the size recommendation."}
        </p>

        {completeness.given < completeness.total && (
          <p className="text-brand bg-brand-veil rounded-md mt-3 px-3 py-2 text-[0.8125rem]">
            {rtl
              ? `${completeness.given} من ${completeness.total}. الطول مطلوب لبناء المجسم.`
              : `${completeness.given} of ${completeness.total}. Height is required to build the figure.`}
          </p>
        )}

        <div className="mt-4 space-y-4">
          {FIELDS.map((field) => {
            const value = profile?.[field.key];
            const bad = value !== undefined && !isPlausible(field.key, value);
            return (
              <label key={field.key} className="block">
                <span className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-ink-muted text-[0.8125rem]">
                    {rtl ? field.ar : field.en}
                  </span>
                  <span className="text-ink text-[0.8125rem] tabular-nums">
                    {value ? `${value} cm` : "—"}
                  </span>
                </span>
                <input
                  type="range"
                  min={field.min}
                  max={field.max}
                  step={1}
                  value={value ?? Math.round((field.min + field.max) / 2)}
                  onChange={(e) => setField(field.key, e.target.value)}
                  className="accent-brand w-full"
                  aria-label={`${rtl ? field.ar : field.en} in centimetres`}
                />
                {bad && (
                  <span className="text-alert text-[0.75rem]">
                    {rtl ? "قيمة غير معقولة." : "That does not look right."}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {/*
          Preferred ease. Not a measurement — a taste — but it changes the
          recommendation by up to two sizes, so it sits with the numbers that
          feed the same calculation rather than off in a settings page.
        */}
        <div className="mt-5">
          <span className="text-eyebrow text-mist mb-2 block uppercase">
            {rtl ? "القَصّة المفضلة" : "Preferred fit"}
          </span>
          <div className="flex gap-2">
            {FIT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => commit({ preferredFit: option.id })}
                aria-pressed={(profile?.preferredFit ?? "regular") === option.id}
                className={cn(
                  "rounded-pill flex-1 cursor-pointer border px-3 py-2 text-[0.8125rem] transition-all",
                  (profile?.preferredFit ?? "regular") === option.id
                    ? "border-ink bg-ink text-white"
                    : "border-line text-ink-muted hover:border-ink/40",
                )}
              >
                {rtl ? option.ar : option.en}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          {!uid ? (
            <p className="text-smoke text-[0.8125rem]">
              <Link href="/login" className="text-brand underline-offset-4 hover:underline">
                {rtl ? "سجّل الدخول" : "Sign in"}
              </Link>{" "}
              {rtl ? "لحفظ قياساتك." : "to save your measurements."}
            </p>
          ) : (
            <p className="text-mist text-[0.75rem]" aria-live="polite">
              {saving
                ? rtl
                  ? "يُحفظ…"
                  : "Saving…"
                : saved
                  ? rtl
                    ? "حُفظ ✓"
                    : "Saved ✓"
                  : rtl
                    ? "يُحفظ في حسابك تلقائياً."
                    : "Saved to your account automatically."}
            </p>
          )}

          {completeness.given > 0 && (
            <button
              type="button"
              onClick={() => void forget()}
              className="text-mist hover:text-alert ms-auto cursor-pointer text-[0.75rem] underline-offset-4 transition-colors hover:underline"
            >
              {rtl ? "احذف قياساتي" : "Forget my measurements"}
            </button>
          )}
        </div>
      </section>

      {/* ---- Photo ------------------------------------------------------ */}
      <section className="border-line border-t pt-6">
        <h3 className="font-display text-ink text-[1.0625rem] font-semibold">
          {rtl ? "صورة (اختيارية)" : "A photo (optional)"}
        </h3>

        {/*
          The honest sentence, where the upload is — not in a footnote. The
          figure is built from the numbers above; the photo is only used if a
          try-on provider is connected.
        */}
        <p className="text-smoke mt-1 text-[0.8125rem]">
          {rtl
            ? "المجسم يُبنى من قياساتك، لا من الصورة. الصورة تُستخدم فقط لتوليد صورة تجربة عند تفعيل المزوّد."
            : "The figure is built from your measurements, not from the photo. A photo is only used to generate a try-on image, and only when that service is connected."}
        </p>

        {!providerConfigured && (
          <p className="text-mist bg-paper-sunken rounded-md mt-3 px-3 py-2 text-[0.8125rem]">
            {rtl
              ? "توليد صور التجربة غير مفعّل على هذا المتجر بعد."
              : "Try-on image generation is not connected on this shop yet."}
            {providerMissing.length > 0 && (
              <span className="mt-1 block font-mono text-[0.6875rem]">
                {providerMissing.join(", ")}
              </span>
            )}
          </p>
        )}

        {/* Consent, asked here and only here. */}
        <label className="mt-4 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={fittingConsent}
            onChange={(e) => {
              setConsent({ fittingRoom: e.target.checked });
              void recordConsent(e.target.checked);
            }}
            className="accent-brand mt-0.5"
          />
          <span className="text-ink text-[0.8125rem]">
            {rtl
              ? "أوافق على رفع صورتي ومعالجتها لغرض تجربة الملابس."
              : "I agree to upload my photo and have it processed for try-on."}
            <span className="text-mist mt-0.5 block text-[0.75rem]">
              {rtl
                ? "تُحفظ في حسابك وحده — لا يستطيع فريق المتجر رؤيتها. تُحذف بعد ٩٠ يوماً، ويمكنك حذفها متى شئت."
                : "Stored to your account only — shop staff cannot see it. Deleted after 90 days, and you can remove it at any time."}
            </span>
          </span>
        </label>

        {fittingConsent && (
          <>
            <ul className="text-smoke mt-4 space-y-1 text-[0.8125rem]">
              {(rtl ? PHOTO_GUIDANCE.ar : PHOTO_GUIDANCE.en).map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="text-mist" aria-hidden="true">
                    ·
                  </span>
                  {line}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label
                className={cn(
                  "border-line hover:border-brand text-ink-muted hover:text-brand rounded-pill border px-4 py-2 text-[0.8125rem]",
                  checking || uploading ? "cursor-wait opacity-60" : "cursor-pointer",
                )}
              >
                {checking
                  ? rtl
                    ? "يُفحص…"
                    : "Checking…"
                  : rtl
                    ? "اختر صورة"
                    : "Choose a photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={checking || uploading}
                  onChange={(e) => pickPhoto(e.target.files)}
                  className="sr-only"
                />
              </label>

              {storedPhoto && (
                <button
                  type="button"
                  onClick={deletePhoto}
                  className="text-alert cursor-pointer text-[0.8125rem] underline-offset-4 hover:underline"
                >
                  {rtl ? "احذف صورتي" : "Delete my photo"}
                </button>
              )}
            </div>

            {/* The quality report: what is wrong, and how to fix it. */}
            {check && (
              <div className="border-line rounded-md mt-4 border p-3.5">
                <div className="flex gap-3">
                  {check.preview && (
                    <span className="bg-paper-sunken rounded-sm relative h-24 w-18 shrink-0 overflow-hidden">
                      <Image
                        src={check.preview}
                        alt=""
                        fill
                        sizes="72px"
                        className="object-cover"
                        unoptimized
                      />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    {check.ok ? (
                      <p className="text-mint text-[0.8125rem] font-medium">
                        {rtl ? "الصورة مناسبة." : "That photo looks usable."}
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {check.issues.map((issue) => (
                          <li key={issue} className="text-alert text-[0.8125rem]">
                            {PHOTO_ISSUE_TEXT[issue][locale]}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-mist mt-1.5 text-[0.6875rem] tabular-nums">
                      {check.width}×{check.height} ·{" "}
                      {rtl ? "الإضاءة" : "light"} {Math.round(check.brightness * 100)}% ·{" "}
                      {rtl ? "الوضوح" : "focus"} {check.sharpness.toFixed(1)}
                    </p>
                  </div>
                </div>

                {check.ok && (
                  <div className="mt-3 flex justify-end">
                    <Button variant="brand" size="sm" loading={uploading} onClick={uploadPhoto}>
                      {rtl ? "احفظ الصورة" : "Save photo"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {storedPhoto && !check && (
              <p className="text-mint mt-3 text-[0.8125rem]">
                {rtl ? "صورتك محفوظة بشكل خاص." : "Your photo is saved privately."}
              </p>
            )}
          </>
        )}
      </section>

      {/*
        The try-on sits under the photo it needs, not on a screen of its own.
        The object path is derived from the stored download URL: the route
        checks the path against the account before reading it, and a URL is
        not a path.
      */}
      <TryOnPanel
        productId={tryOnProductId}
        personImagePath={storedPhoto ? storagePathFromUrl(storedPhoto) || null : null}
        locale={locale}
      />

      {error && (
        <p role="alert" className="text-alert text-[0.8125rem]">
          {error}
        </p>
      )}
    </div>
  );
}
