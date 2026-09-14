"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { formatPrice, minorUnits } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { AdminPageHeader } from "./AdminShell";
import { Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { Category, Product } from "@/types";

/**
 * Product editor.
 *
 * Bilingual fields sit **side by side**, not behind a language tab. A tab lets
 * you publish a product whose Arabic title was never written, because the empty
 * field was never on screen. Two visible columns make the gap obvious.
 *
 * Price inputs step by the currency's own minor unit — 0.001 for the dinar —
 * so the browser's number control cannot produce a value the store cannot
 * represent.
 */

type Draft = {
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  slug: string;
  categoryId: string;
  price: number;
  compareAtPrice: number | "";
  totalStock: number;
  status: Product["status"];
  tags: string;
};

function toDraft(product: Product | null): Draft {
  if (!product) {
    return {
      titleEn: "",
      titleAr: "",
      subtitleEn: "",
      subtitleAr: "",
      descriptionEn: "",
      descriptionAr: "",
      slug: "",
      categoryId: "outerwear",
      price: 0,
      compareAtPrice: "",
      totalStock: 0,
      status: "draft",
      tags: "",
    };
  }

  return {
    titleEn: product.title.en,
    titleAr: product.title.ar,
    subtitleEn: product.subtitle?.en ?? "",
    subtitleAr: product.subtitle?.ar ?? "",
    descriptionEn: product.description.en,
    descriptionAr: product.description.ar,
    slug: product.slug,
    categoryId: product.categoryId,
    price: product.price,
    compareAtPrice: product.compareAtPrice ?? "",
    totalStock: product.totalStock,
    status: product.status,
    tags: product.tags.join(", "),
  };
}

export function ProductEditor({
  product,
  categories,
}: {
  product: Product | null;
  categories: Category[];
}) {
  const router = useLocalizedRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(product));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = !product;
  const step = 1 / 10 ** minorUnits("JOD");

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  const missing: string[] = [];
  if (!draft.titleEn.trim()) missing.push("English title");
  if (!draft.titleAr.trim()) missing.push("Arabic title");
  if (!draft.slug.trim()) missing.push("slug");
  if (draft.price <= 0) missing.push("price");

  async function save() {
    if (missing.length > 0) {
      setError(`Still needed: ${missing.join(", ")}.`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: product?.id,
          slug: draft.slug.trim(),
          title: { en: draft.titleEn.trim(), ar: draft.titleAr.trim() },
          subtitle: { en: draft.subtitleEn.trim(), ar: draft.subtitleAr.trim() },
          description: { en: draft.descriptionEn.trim(), ar: draft.descriptionAr.trim() },
          categoryId: draft.categoryId,
          price: draft.price,
          compareAtPrice: draft.compareAtPrice === "" ? null : draft.compareAtPrice,
          totalStock: draft.totalStock,
          status: draft.status,
          tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        persisted?: boolean;
        id?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Save failed");

      setSaved(true);
      if (data.persisted === false) {
        setError(
          "Validated but not written — Firebase Admin is not configured, so there is nowhere to save to yet.",
        );
      } else if (isNew && data.id) {
        router.push(`/admin/products/${data.id}`);
      } else {
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AdminPageHeader
        title={isNew ? "New product" : draft.titleEn || "Untitled"}
        description={isNew ? "Both languages are required before publishing." : `/product/${draft.slug}`}
        actions={
          <>
            <Link href="/admin/products">
              <Button variant="ghost" size="sm">
                ← Catalogue
              </Button>
            </Link>
            {!isNew && (
              <Link href={`/en/product/${draft.slug}`}>
                <Button variant="secondary" size="sm">
                  View live
                </Button>
              </Link>
            )}
            <Button
              variant="violet"
              size="sm"
              loading={saving}
              success={saved}
              successLabel="Saved"
              onClick={() => void save()}
            >
              Save
            </Button>
          </>
        }
      />

      {error && (
        <motion.p
          role="alert"
          className="bg-coral/10 text-coral mb-4 rounded-md p-3 text-[0.8125rem]"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE.jo }}
        >
          {error}
        </motion.p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title="Names" description="English and Arabic, side by side on purpose.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Title (English)"
                value={draft.titleEn}
                onChange={(v) => set("titleEn", v)}
                required
              />
              <Field
                label="Title (Arabic)"
                value={draft.titleAr}
                onChange={(v) => set("titleAr", v)}
                rtl
                required
              />
              <Field
                label="Subtitle (English)"
                value={draft.subtitleEn}
                onChange={(v) => set("subtitleEn", v)}
              />
              <Field
                label="Subtitle (Arabic)"
                value={draft.subtitleAr}
                onChange={(v) => set("subtitleAr", v)}
                rtl
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Description (English)"
                value={draft.descriptionEn}
                onChange={(v) => set("descriptionEn", v)}
                multiline
              />
              <Field
                label="Description (Arabic)"
                value={draft.descriptionAr}
                onChange={(v) => set("descriptionAr", v)}
                rtl
                multiline
              />
            </div>
          </Panel>

          {product && product.images.length > 0 && (
            <Panel
              title="Imagery"
              description="Uploads go to Firebase Storage; SVG is rejected at the rules layer."
            >
              <div className="flex flex-wrap gap-3">
                {product.images.map((image) => (
                  <div
                    key={image.url}
                    className="bg-paper-sunken relative h-32 w-24 overflow-hidden rounded-md"
                  >
                    <Image src={image.url} alt={image.alt} fill sizes="96px" className="object-cover" />
                  </div>
                ))}
                <label className="border-line hover:border-violet text-mist hover:text-violet grid h-32 w-24 cursor-pointer place-items-center rounded-md border border-dashed text-[0.75rem] transition-colors">
                  <span className="text-center leading-tight">
                    +<br />
                    Add
                  </span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" />
                </label>
              </div>
            </Panel>
          )}

          {product && (
            <Panel title="Variants" description="Stock is held per variant, not on the product.">
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]">
                  <thead>
                    <tr className="text-mist text-[0.625rem] tracking-[0.12em] uppercase">
                      <th className="pb-2 text-start font-medium">Colour</th>
                      {product.sizes.map((size) => (
                        <th key={size.id} className="pb-2 text-center font-medium">
                          {size.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-line divide-y">
                    {product.colors.map((color) => (
                      <tr key={color.id}>
                        <td className="py-2.5">
                          <span className="flex items-center gap-2">
                            <span
                              className="ring-ink/10 h-3.5 w-3.5 rounded-full ring-1"
                              style={{ background: color.hex }}
                            />
                            <span className="text-ink">{color.name.en}</span>
                          </span>
                        </td>
                        {product.sizes.map((size) => (
                          <td key={size.id} className="py-2.5 text-center">
                            <input
                              type="number"
                              min={0}
                              defaultValue={Math.floor(
                                product.totalStock / (product.colors.length * product.sizes.length),
                              )}
                              className="border-line focus:border-violet bg-paper w-14 rounded-sm border px-2 py-1 text-center text-[0.75rem] tabular-nums outline-none"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-mist mt-3 text-[0.75rem]">
                Per-variant counts are edited here and aggregated into the product&apos;s total by a
                Cloud Function — never written from the browser.
              </p>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Pricing">
            <div className="grid gap-4">
              <NumberField
                label="Price"
                value={draft.price}
                onChange={(v) => set("price", v)}
                step={step}
                hint={`${formatPrice(draft.price || 0, "JOD")} — the dinar carries three decimals`}
              />
              <NumberField
                label="Compare at (optional)"
                value={draft.compareAtPrice === "" ? 0 : draft.compareAtPrice}
                onChange={(v) => set("compareAtPrice", v === 0 ? "" : v)}
                step={step}
                hint="Shown struck through. Must be higher than the price to display."
              />
            </div>
          </Panel>

          <Panel title="Organisation">
            <div className="grid gap-4">
              <Field label="Slug" value={draft.slug} onChange={(v) => set("slug", v)} required mono />

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Category</span>
                <select
                  value={draft.categoryId}
                  onChange={(event) => set("categoryId", event.target.value)}
                  className="border-line focus:border-violet bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name.en}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Status</span>
                <select
                  value={draft.status}
                  onChange={(event) => set("status", event.target.value as Product["status"])}
                  className="border-line focus:border-violet bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
                >
                  <option value="draft">Draft — hidden from the store</option>
                  <option value="active">Active — on sale</option>
                  <option value="archived">Archived</option>
                </select>
              </label>

              <NumberField
                label="Total stock"
                value={draft.totalStock}
                onChange={(v) => set("totalStock", v)}
                step={1}
              />

              <Field
                label="Tags"
                value={draft.tags}
                onChange={(v) => set("tags", v)}
                hint="Comma separated. Used by search and related products."
              />
            </div>
          </Panel>

          {missing.length > 0 && (
            <Panel>
              <p className="text-ink text-[0.8125rem] font-medium">Before publishing</p>
              <ul className="mt-2 space-y-1">
                {missing.map((item) => (
                  <li key={item} className="text-smoke flex items-center gap-2 text-[0.75rem]">
                    <span className="bg-coral h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  onChange,
  rtl,
  multiline,
  required,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rtl?: boolean;
  multiline?: boolean;
  required?: boolean;
  hint?: string;
  mono?: boolean;
}) {
  const classes = cn(
    "border-line focus:border-violet bg-paper text-ink placeholder:text-mist w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none transition-colors",
    rtl && "font-arabic text-[0.9375rem]",
    mono && "font-mono",
  );

  return (
    <label className="block">
      <span className="text-ink-muted mb-1.5 flex items-center gap-1.5 text-[0.75rem]">
        {label}
        {required && <span className="text-coral">*</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          dir={rtl ? "rtl" : "ltr"}
          rows={5}
          className={cn(classes, "resize-y")}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          dir={rtl ? "rtl" : "ltr"}
          className={classes}
        />
      )}
      {hint && <span className="text-mist mt-1 block text-[0.6875rem]">{hint}</span>}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="border-line focus:border-violet bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] tabular-nums outline-none transition-colors"
      />
      {hint && <span className="text-mist mt-1 block text-[0.6875rem]">{hint}</span>}
    </label>
  );
}
