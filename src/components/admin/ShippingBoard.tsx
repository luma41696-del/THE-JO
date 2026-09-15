"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { AdminPageHeader } from "./AdminShell";
import { Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { ShippingMethod, ShippingZone } from "@/types";

/**
 * Delivery rates.
 *
 * Methods answer *how fast*; zones answer *where to*. They are edited on one
 * screen because a merchant setting carriage is thinking about one table — and
 * because the interesting cases live between them: express to the south, free
 * delivery in Amman but not in Aqaba.
 */
export function ShippingBoard({
  methods: initialMethods,
  zones: initialZones,
  storeThreshold,
}: {
  methods: ShippingMethod[];
  zones: ShippingZone[];
  /** The shop-wide free-delivery threshold, shown as the inherited default. */
  storeThreshold: number;
}) {
  const [methods, setMethods] = useState<ShippingMethod[]>(initialMethods);
  const [zones, setZones] = useState<ShippingZone[]>(initialZones);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchMethod(id: string, patch: Partial<ShippingMethod>) {
    setMethods((current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    setSaved(false);
  }

  function patchZone(id: string, patch: Partial<ShippingZone>) {
    setZones((current) => current.map((z) => (z.id === id ? { ...z, ...patch } : z)));
    setSaved(false);
  }

  function addZone() {
    const n = zones.length + 1;
    setZones((current) => [
      ...current,
      {
        id: `zone-${n}-${Date.now().toString(36).slice(-4)}`,
        name: { en: "", ar: "" },
        areas: [],
        surcharge: 0,
        order: current.length,
      },
    ]);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/shipping", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ methods, zones }),
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
      setError(err instanceof Error ? err.message : "Those rates could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Delivery"
        description="What carriage costs, how long it takes, and where you deliver."
      />

      {/* ---- Methods --------------------------------------------------- */}
      <Panel title="Methods" description="The speeds a customer can choose between.">
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="text-mist text-[0.625rem] tracking-[0.12em] uppercase">
                <th className="pb-2 text-start font-medium">Method</th>
                <th className="pb-2 text-center font-medium">Price</th>
                <th className="pb-2 text-center font-medium">Days</th>
                <th className="pb-2 text-center font-medium">Free above</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {methods.map((method) => (
                <tr key={method.id}>
                  <td className="py-2.5">
                    <span className="text-ink block">{method.name.en}</span>
                    <span className="text-mist block text-[0.6875rem]">{method.speed}</span>
                  </td>
                  <td className="py-2.5 text-center">
                    <Num
                      value={method.price}
                      label={`Price for ${method.name.en}`}
                      onChange={(v) => patchMethod(method.id, { price: v })}
                    />
                  </td>
                  <td className="py-2.5 text-center whitespace-nowrap">
                    <Num
                      value={method.minDays}
                      width="w-14"
                      label={`Fastest day for ${method.name.en}`}
                      onChange={(v) => patchMethod(method.id, { minDays: v })}
                    />
                    <span className="text-mist mx-1">–</span>
                    <Num
                      value={method.maxDays}
                      width="w-14"
                      label={`Slowest day for ${method.name.en}`}
                      onChange={(v) => patchMethod(method.id, { maxDays: v })}
                    />
                  </td>
                  <td className="py-2.5 text-center">
                    <Num
                      value={method.freeAbove ?? ""}
                      placeholder="—"
                      label={`Free above for ${method.name.en}`}
                      onChange={(v) => patchMethod(method.id, { freeAbove: v })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-mist mt-3 text-[0.75rem]">
          An empty “free above” means this method is never free on its own. The
          shop-wide threshold is {storeThreshold} JOD, set under Settings.
        </p>
      </Panel>

      {/* ---- Zones ----------------------------------------------------- */}
      <Panel
        title="Zones"
        description="Matched against the city or region a customer types. An address matching none pays the method price."
      >
        {zones.length === 0 && (
          <p className="text-mist text-[0.8125rem]">
            No zones. Every address is charged the method price — which is a
            fine way to run a shop, until the south starts costing more than it
            earns.
          </p>
        )}

        <ul className="space-y-4">
          {zones.map((zone) => (
            <li key={zone.id} className="border-line rounded-md border p-3.5">
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={zone.name.en}
                  placeholder="Zone name (English)"
                  onChange={(e) => patchZone(zone.id, { name: { ...zone.name, en: e.target.value } })}
                  aria-label={`English name for ${zone.id}`}
                  className="border-line focus:border-brand bg-paper rounded-sm border px-2 py-1.5 text-[0.8125rem] outline-none"
                />
                <input
                  value={zone.name.ar}
                  dir="rtl"
                  placeholder="اسم المنطقة"
                  onChange={(e) => patchZone(zone.id, { name: { ...zone.name, ar: e.target.value } })}
                  aria-label={`Arabic name for ${zone.id}`}
                  className="border-line focus:border-brand bg-paper rounded-sm border px-2 py-1.5 text-[0.8125rem] outline-none"
                />
              </div>

              <label className="mt-2 block">
                <span className="text-mist mb-1 block text-[0.6875rem] tracking-[0.1em] uppercase">
                  Cities and regions, comma separated
                </span>
                <input
                  value={zone.areas.join(", ")}
                  placeholder="Amman, عمّان, Zarqa"
                  onChange={(e) =>
                    patchZone(zone.id, { areas: e.target.value.split(",").map((a) => a.trim()) })
                  }
                  className="border-line focus:border-brand bg-paper w-full rounded-sm border px-2 py-1.5 text-[0.8125rem] outline-none"
                />
                {/* Customers type their own address, in either language. */}
                <span className="text-mist mt-1 block text-[0.75rem]">
                  List both spellings — a customer typing عمّان must match the
                  same zone as one typing Amman.
                </span>
              </label>

              <div className="mt-3 flex flex-wrap items-end gap-4">
                <label className="text-center">
                  <span className="text-mist block text-[0.6875rem] tracking-[0.1em] uppercase">
                    Surcharge
                  </span>
                  <Num
                    value={zone.surcharge}
                    label={`Surcharge for ${zone.name.en || zone.id}`}
                    onChange={(v) => patchZone(zone.id, { surcharge: v })}
                  />
                </label>

                <label className="text-center">
                  <span className="text-mist block text-[0.6875rem] tracking-[0.1em] uppercase">
                    Free above
                  </span>
                  <Num
                    value={zone.freeAbove ?? ""}
                    placeholder={String(storeThreshold)}
                    label={`Free above for ${zone.name.en || zone.id}`}
                    onChange={(v) => patchZone(zone.id, { freeAbove: v })}
                  />
                </label>

                <label className="text-center">
                  <span className="text-mist block text-[0.6875rem] tracking-[0.1em] uppercase">
                    Extra days
                  </span>
                  <Num
                    value={zone.extraDays ?? ""}
                    width="w-16"
                    placeholder="0"
                    label={`Extra days for ${zone.name.en || zone.id}`}
                    onChange={(v) => patchZone(zone.id, { extraDays: v })}
                  />
                </label>

                <label className="flex items-center gap-2 pb-1.5">
                  <input
                    type="checkbox"
                    checked={zone.excluded ?? false}
                    onChange={(e) => patchZone(zone.id, { excluded: e.target.checked })}
                    className="accent-brand"
                  />
                  <span className="text-ink-muted text-[0.8125rem]">Do not deliver here</span>
                </label>

                <button
                  type="button"
                  onClick={() => setZones((c) => c.filter((z) => z.id !== zone.id))}
                  className="text-mist hover:text-alert ms-auto cursor-pointer pb-1.5 text-[0.8125rem] underline-offset-4 hover:underline"
                >
                  Remove zone
                </button>
              </div>

              {zone.excluded && (
                <p className="text-alert mt-2 text-[0.75rem]">
                  Checkout will refuse addresses here, at the address step and
                  again on the server.
                </p>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={addZone}
          className="text-brand mt-4 cursor-pointer text-[0.8125rem] underline-offset-4 hover:underline"
        >
          Add a zone
        </button>
      </Panel>

      <div className="flex items-center gap-4">
        <Button variant="brand" loading={saving} success={saved} successLabel="Saved" onClick={save}>
          Save delivery rates
        </Button>
        <p className="text-mist text-[0.8125rem]">
          The cart, the checkout and the server all quote from these.
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

function Num({
  value,
  onChange,
  label,
  placeholder,
  width = "w-20",
}: {
  value: number | "";
  onChange: (value: number) => void;
  label: string;
  placeholder?: string;
  width?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      step="0.001"
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={cn(
        "border-line focus:border-brand bg-paper rounded-sm border px-2 py-1 text-center text-[0.75rem] tabular-nums outline-none",
        width,
      )}
    />
  );
}
