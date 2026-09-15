"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { AdminPageHeader } from "./AdminShell";
import { Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { StoreSettings } from "@/data/site-content";

/**
 * Store settings.
 *
 * Everything here is a sentence a customer reads somewhere else: "Free
 * delivery over 75 JOD" on the product page, "14-day returns" in the
 * announcement bar, the phone number on the contact page. That is why the
 * form shows the composed sentence next to the number rather than the number
 * alone — the thing being edited is the promise, not the integer.
 */

interface Row {
  label: string;
  href: string;
}

export function SettingsBoard({ settings }: { settings: StoreSettings }) {
  const [form, setForm] = useState<StoreSettings>(settings);
  const [social, setSocial] = useState<Row[]>(settings.social);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch<K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function patchContact<K extends keyof StoreSettings["contact"]>(
    key: K,
    value: StoreSettings["contact"][K],
  ) {
    setForm((current) => ({ ...current, contact: { ...current.contact, [key]: value } }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ...form, social }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        persisted?: boolean;
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Save failed.");

      setSaved(true);
      if (data.persisted === false) {
        setError(
          "Validated but not written — Firebase Admin is not configured, so there is nowhere to save to yet.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Those settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const [minDays, maxDays] = form.standardDeliveryDays;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Store settings"
        description="The numbers and details the storefront quotes back to customers."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---- Promises ------------------------------------------------ */}
        <Panel
          title="Delivery and returns"
          description="Changing these rewrites the sentences that quote them."
        >
          <div className="space-y-4">
            <NumberRow
              label="Free delivery over"
              suffix="JOD"
              value={form.freeShippingThreshold}
              onChange={(v) => patch("freeShippingThreshold", v)}
              /* The composed sentence, so the merchant edits the promise. */
              preview={`"Free delivery over ${form.freeShippingThreshold} JOD"`}
            />

            <NumberRow
              label="Return window"
              suffix="days"
              value={form.returnWindowDays}
              onChange={(v) => patch("returnWindowDays", v)}
              preview={`"Returns within ${form.returnWindowDays} days"`}
            />

            <NumberRow
              label="Low-stock alert at"
              suffix="units per variant"
              value={form.lowStockThreshold}
              onChange={(v) => patch("lowStockThreshold", v)}
              preview={`Flags any colour, size or design down to ${form.lowStockThreshold} — not the product total`}
            />

            <div>
              <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">
                Standard delivery
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={minDays}
                  onChange={(e) =>
                    patch("standardDeliveryDays", [Number(e.target.value) || 0, maxDays])
                  }
                  aria-label="Fastest delivery in business days"
                  className="border-line focus:border-brand bg-paper w-20 rounded-sm border px-2 py-1.5 text-center text-[0.8125rem] tabular-nums outline-none"
                />
                <span className="text-mist text-[0.8125rem]">to</span>
                <input
                  type="number"
                  min={0}
                  value={maxDays}
                  onChange={(e) =>
                    patch("standardDeliveryDays", [minDays, Number(e.target.value) || 0])
                  }
                  aria-label="Slowest delivery in business days"
                  className="border-line focus:border-brand bg-paper w-20 rounded-sm border px-2 py-1.5 text-center text-[0.8125rem] tabular-nums outline-none"
                />
                <span className="text-mist text-[0.8125rem]">business days</span>
              </div>
              {minDays > maxDays && (
                <p className="text-alert mt-1 text-[0.75rem]">
                  The fastest day cannot be later than the slowest — this would
                  read as “{minDays}–{maxDays} days” on the product page.
                </p>
              )}
            </div>
          </div>
        </Panel>

        {/* ---- Contact ------------------------------------------------- */}
        <Panel title="Contact" description="Shown on the contact page and in the footer.">
          <div className="space-y-4">
            <TextRow
              label="Email"
              type="email"
              value={form.contact.email}
              onChange={(v) => patchContact("email", v)}
            />
            <TextRow
              label="Phone"
              value={form.contact.phone}
              onChange={(v) => patchContact("phone", v)}
            />
            <TextRow
              label="WhatsApp"
              value={form.contact.whatsapp ?? ""}
              onChange={(v) => patchContact("whatsapp", v)}
              hint="Leave empty to hide the WhatsApp link."
            />
            <BilingualRow
              label="Opening hours"
              value={form.contact.hours}
              onChange={(v) => patchContact("hours", v)}
            />
            <BilingualRow
              label="Address"
              value={form.contact.address}
              onChange={(v) => patchContact("address", v)}
            />
          </div>
        </Panel>

        {/* ---- Social -------------------------------------------------- */}
        <Panel title="Social links" description="Full https links only.">
          <ul className="space-y-2">
            {social.map((row, index) => (
              <li key={index} className="flex items-center gap-2">
                <input
                  value={row.label}
                  placeholder="Instagram"
                  onChange={(e) =>
                    setSocial((current) =>
                      current.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)),
                    )
                  }
                  aria-label={`Social link ${index + 1} label`}
                  className="border-line focus:border-brand bg-paper w-32 shrink-0 rounded-sm border px-2 py-1.5 text-[0.8125rem] outline-none"
                />
                <input
                  value={row.href}
                  placeholder="https://instagram.com/netsale"
                  onChange={(e) =>
                    setSocial((current) =>
                      current.map((r, i) => (i === index ? { ...r, href: e.target.value } : r)),
                    )
                  }
                  aria-label={`Social link ${index + 1} address`}
                  className={cn(
                    "border-line focus:border-brand bg-paper min-w-0 flex-1 rounded-sm border px-2 py-1.5 text-[0.8125rem] outline-none",
                    row.href && !/^https?:\/\//i.test(row.href) && "border-alert",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setSocial((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Remove social link ${index + 1}`}
                  className="text-mist hover:text-alert cursor-pointer px-1"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setSocial((current) => [...current, { label: "", href: "" }])}
            className="text-brand mt-3 cursor-pointer text-[0.8125rem] underline-offset-4 hover:underline"
          >
            Add a link
          </button>

          {social.some((r) => r.href && !/^https?:\/\//i.test(r.href)) && (
            <p className="text-alert mt-2 text-[0.75rem]">
              Every link must start with http:// or https://. These are rendered
              in the footer of every page.
            </p>
          )}
        </Panel>

        {/* ---- Legal --------------------------------------------------- */}
        <Panel title="Trading details" description="Used on invoices and the terms page.">
          <div className="space-y-4">
            <TextRow
              label="Trading name"
              value={form.legal.tradingName}
              onChange={(v) => patch("legal", { ...form.legal, tradingName: v })}
            />
            <BilingualRow
              label="Country"
              value={form.legal.country}
              onChange={(v) => patch("legal", { ...form.legal, country: v })}
            />
          </div>
        </Panel>
      </div>

      <div className="flex items-center gap-4">
        <Button variant="brand" loading={saving} success={saved} successLabel="Saved" onClick={save}>
          Save settings
        </Button>
        <p className="text-mist text-[0.8125rem]">
          Saving refreshes every page that quotes these numbers.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-alert text-[0.8125rem]">
          {error}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NumberRow({
  label,
  suffix,
  value,
  onChange,
  preview,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (value: number) => void;
  preview: string;
}) {
  return (
    <div>
      <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          aria-label={label}
          className="border-line focus:border-brand bg-paper w-28 rounded-sm border px-2 py-1.5 text-[0.8125rem] tabular-nums outline-none"
        />
        <span className="text-mist text-[0.8125rem]">{suffix}</span>
      </div>
      <p className="text-mist mt-1 text-[0.75rem] italic">{preview}</p>
    </div>
  );
}

function TextRow({
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-line focus:border-brand bg-paper w-full rounded-sm border px-2 py-1.5 text-[0.8125rem] outline-none"
      />
      {hint && <span className="text-mist mt-1 block text-[0.75rem]">{hint}</span>}
    </label>
  );
}

function BilingualRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { en: string; ar: string };
  onChange: (value: { en: string; ar: string }) => void;
}) {
  return (
    <div>
      <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">{label}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={value.en}
          placeholder="English"
          onChange={(e) => onChange({ ...value, en: e.target.value })}
          aria-label={`${label} in English`}
          className="border-line focus:border-brand bg-paper rounded-sm border px-2 py-1.5 text-[0.8125rem] outline-none"
        />
        <input
          value={value.ar}
          dir="rtl"
          placeholder="العربية"
          onChange={(e) => onChange({ ...value, ar: e.target.value })}
          aria-label={`${label} in Arabic`}
          className="border-line focus:border-brand bg-paper rounded-sm border px-2 py-1.5 text-[0.8125rem] outline-none"
        />
      </div>
    </div>
  );
}
