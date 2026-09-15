"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { formatPrice, minorUnits } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { gtinKind, isValidGtin } from "@/lib/product";
import {
  ACCEPT_ATTRIBUTE,
  deleteProductImage,
  uploadProductImage,
} from "@/lib/firebase/upload";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import { OptionsEditor } from "./OptionsEditor";
import type {
  Category,
  Product,
  ProductColor,
  ProductDesign,
  ProductImage,
  ProductSize,
  ProductType,
  ProductVariant,
  ShippingClass,
} from "@/types";

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

  type: ProductType;
  sku: string;
  gtin: string;
  shippingClassId: string;
  /** "" means no cap — distinct from 0, which would mean unbuyable. */
  maxPerOrder: number | "";
  /** Comma-separated product ids. */
  upsellIds: string;
  crossSellIds: string;
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
      type: "variable",
      sku: "",
      gtin: "",
      shippingClassId: "standard",
      maxPerOrder: "",
      upsellIds: "",
      crossSellIds: "",
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
    type: product.type,
    sku: product.sku,
    gtin: product.gtin ?? "",
    shippingClassId: product.shippingClassId ?? "standard",
    maxPerOrder: product.maxPerOrder ?? "",
    upsellIds: product.upsellIds.join(", "),
    crossSellIds: product.crossSellIds.join(", "),
  };
}

export function ProductEditor({
  product,
  categories,
  shippingClasses = [],
}: {
  product: Product | null;
  categories: Category[];
  shippingClasses?: ShippingClass[];
}) {
  const { t } = useAdminLocale();
  const router = useLocalizedRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(product));
  const [saving, setSaving] = useState(false);

  /*
   * Imagery is edited locally and saved with the product, not on every nudge.
   * Reordering four images would otherwise be four writes and four chances to
   * half-apply an order.
   */
  const [images, setImages] = useState<ProductImage[]>(product?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /*
   * Variant stock, edited as a grid.
   *
   * What was here before was worse than read-only: the input's
   * `defaultValue` was `totalStock / (colours × sizes)` — an *invented
   * average* presented as a per-size count. A merchant reading "12" for a size
   * that actually had none had no way to know, and nothing they typed was ever
   * saved. These are the real rows now.
   */
  /*
   * Options are local state like images and variants: they are edited
   * together and saved with the product, so that adding a colour and pricing
   * its rows is one save rather than three.
   */
  const [colors, setColors] = useState<ProductColor[]>(product?.colors ?? []);
  const [sizes, setSizes] = useState<ProductSize[]>(product?.sizes ?? []);
  const [variants, setVariants] = useState<ProductVariant[]>(product?.variants ?? []);

  /*
   * Artwork options — embroideries, prints, placements.
   *
   * A third axis, so the grid below is shown one design at a time rather than
   * as a colour × size × design cube. A merchant editing stock is looking at
   * one artwork's table; a flattened cube of forty inputs is not a table
   * anybody can read, let alone keep correct.
   */
  const [designs, setDesigns] = useState<ProductDesign[]>(product?.designs ?? []);
  const [gridDesignId, setGridDesignId] = useState<string>(product?.designs?.[0]?.id ?? "");
  const [designBusy, setDesignBusy] = useState(false);

  const variantAt = (colorId: string, sizeId: string, designId: string) => {
    const rows = variants.filter((v) => v.colorId === colorId && v.sizeId === sizeId);
    // An unscoped row predates designs and stands for all of them, exactly as
    // `variantFor` resolves it on the storefront.
    return rows.find((v) => (v.designId ?? "") === designId) ?? rows.find((v) => !v.designId);
  };

  function setVariantStock(colorId: string, sizeId: string, designId: string, stock: number) {
    const safe = Math.max(0, Math.floor(Number.isFinite(stock) ? stock : 0));
    const target = variantAt(colorId, sizeId, designId);
    if (!target) return;
    setVariants((current) => current.map((v) => (v.sku === target.sku ? { ...v, stock: safe } : v)));
  }

  function patchDesign(id: string, patch: Partial<ProductDesign>) {
    setDesigns((current) => current.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function moveDesign(index: number, delta: number) {
    setDesigns((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((d, i) => ({ ...d, position: i }));
    });
  }

  /**
   * Withdraw a design rather than delete it.
   *
   * Orders already placed carry the design's name on their lines, and the
   * admin resolves that name from the product. Deleting the record would turn
   * a customer's invoice into "Boxy Cotton Tee · Bone · M" with the one detail
   * that identified it missing. `available: false` takes it out of the picker
   * and leaves the history intact.
   */
  function withdrawDesign(id: string) {
    patchDesign(id, { available: false });
  }

  async function addDesign(file: File) {
    if (!product) return;
    const name = window.prompt("Design name (English)")?.trim();
    if (!name) return;
    const nameAr = window.prompt("اسم التصميم (بالعربية)")?.trim() || name;
    const alt = window.prompt("Describe the thumbnail for screen readers", `${name} — `)?.trim();
    if (!alt) {
      setUploadError(t("pe.designAltRequired"));
      return;
    }

    setDesignBusy(true);
    setUploadError(null);
    try {
      const thumbnail = await uploadProductImage(product.id, file, alt);
      const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now()
        .toString(36)
        .slice(-4)}`;
      setDesigns((current) => [
        ...current,
        { id, name: { en: name, ar: nameAr }, thumbnail, available: true, position: current.length },
      ]);
      setGridDesignId((current) => current || id);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "That thumbnail could not be uploaded.",
      );
    } finally {
      setDesignBusy(false);
    }
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0 || !product) return;
    setUploadError(null);
    setUploading(true);

    try {
      const files = Array.from(list);
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        /*
         * Alt text is asked for, never derived. "IMG_4821.jpg" as alt text is
         * worse than none — a screen reader announces it in full and the
         * listener learns nothing.
         */
        const alt =
          window.prompt(
            `Describe image ${i + 1} of ${files.length} for screen readers`,
            draft.titleEn ? `${draft.titleEn} — ` : "",
          ) ?? "";
        if (!alt.trim()) {
          setUploadError(t("pe.imageAltRequired"));
          break;
        }

        const uploaded = await uploadProductImage(product.id, file, alt, {
          onProgress: (fraction) =>
            setUploadProgress((i + fraction) / files.length),
        });
        setImages((current) => [...current, uploaded]);
      }
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "That image could not be uploaded.",
      );
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  function moveImage(index: number, delta: number) {
    setImages((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  /*
   * Removed from the product immediately, deleted from Storage in the
   * background. If the delete fails the product is still correct — an orphaned
   * object costs pennies, whereas blocking the edit on a storage hiccup costs
   * the merchant their afternoon.
   */
  function removeImage(index: number) {
    const image = images[index];
    setImages((current) => current.filter((_, i) => i !== index));
    if (image) void deleteProductImage(image.url).catch(() => {});
  }
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
          images,
          // Sent even when empty, so removing the last colour clears it rather
          // than leaving the old array in place.
          ...(draft.type === "variable" ? { colors, sizes } : {}),
          // Only sent for a variable product; a simple one keeps its own total.
          ...(draft.type === "variable" && variants.length > 0 ? { variants } : {}),
          // Sent even when empty, so removing the last design actually clears
          // it rather than leaving the old array in place.
          ...(draft.type === "variable" ? { designs } : {}),
          status: draft.status,
          tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
          type: draft.type,
          sku: draft.sku.trim(),
          gtin: draft.gtin.trim() || null,
          shippingClassId: draft.shippingClassId || null,
          maxPerOrder: draft.maxPerOrder === "" ? null : draft.maxPerOrder,
          upsellIds: draft.upsellIds.split(",").map((t) => t.trim()).filter(Boolean),
          crossSellIds: draft.crossSellIds.split(",").map((t) => t.trim()).filter(Boolean),
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
      setError(caught instanceof Error ? caught.message : t("pe.couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AdminPageHeader
        title={isNew ? t("pe.newProduct") : draft.titleEn || t("pe.untitled")}
        description={isNew ? t("pe.bothLanguages") : `/product/${draft.slug}`}
        actions={
          <>
            <Link href="/admin/products">
              <Button variant="ghost" size="sm">
                ← {t("pe.catalogue")}
              </Button>
            </Link>
            {!isNew && (
              <Link href={`/en/product/${draft.slug}`}>
                <Button variant="secondary" size="sm">
                  {t("pe.viewLive")}
                </Button>
              </Link>
            )}
            <Button
              variant="brand"
              size="sm"
              loading={saving}
              success={saved}
              successLabel={t("common.saved")}
              onClick={() => void save()}
            >
              {t("common.save")}
            </Button>
          </>
        }
      />

      {error && (
        <motion.p
          role="alert"
          className="bg-alert/10 text-alert mb-4 rounded-md p-3 text-[0.8125rem]"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE.brand }}
        >
          {error}
        </motion.p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title={t("pe.names")} description={t("pe.namesHint")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("pe.titleEn")}
                value={draft.titleEn}
                onChange={(v) => set("titleEn", v)}
                required
              />
              <Field
                label={t("pe.titleAr")}
                value={draft.titleAr}
                onChange={(v) => set("titleAr", v)}
                rtl
                required
              />
              <Field
                label={t("pe.subtitleEn")}
                value={draft.subtitleEn}
                onChange={(v) => set("subtitleEn", v)}
              />
              <Field
                label={t("pe.subtitleAr")}
                value={draft.subtitleAr}
                onChange={(v) => set("subtitleAr", v)}
                rtl
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label={t("pe.descEn")}
                value={draft.descriptionEn}
                onChange={(v) => set("descriptionEn", v)}
                multiline
              />
              <Field
                label={t("pe.descAr")}
                value={draft.descriptionAr}
                onChange={(v) => set("descriptionAr", v)}
                rtl
                multiline
              />
            </div>
          </Panel>

          {product && (
            <Panel
              title={t("pe.imagery")}
              description={t("pe.firstImageHint")}
            >
              <div className="flex flex-wrap gap-3">
                {images.map((image, index) => (
                  <div
                    key={image.url}
                    className="bg-paper-sunken group relative h-32 w-24 overflow-hidden rounded-md"
                  >
                    <Image
                      src={image.url}
                      alt={image.alt}
                      fill
                      sizes="96px"
                      className="object-cover"
                    />

                    {index === 0 && (
                      <span className="bg-ink absolute start-1 top-1 rounded-xs px-1.5 py-0.5 text-[0.5625rem] font-semibold tracking-wide text-white uppercase">
                        {t("pe.main")}
                      </span>
                    )}

                    {/*
                      Reorder by nudging rather than drag-and-drop: a drag
                      handle needs a pointer, and this panel is used on tablets
                      on a stock-room bench. Arrows work with a finger and with
                      a keyboard.
                    */}
                    <div className="bg-ink/70 absolute inset-x-0 bottom-0 flex items-center justify-between px-1 py-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => moveImage(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move image ${index + 1} earlier`}
                        className="cursor-pointer px-1.5 text-white disabled:opacity-30"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        aria-label={`Remove image ${index + 1}`}
                        className="text-alert cursor-pointer px-1.5"
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(index, 1)}
                        disabled={index === images.length - 1}
                        aria-label={`Move image ${index + 1} later`}
                        className="cursor-pointer px-1.5 text-white disabled:opacity-30"
                      >
                        →
                      </button>
                    </div>
                  </div>
                ))}

                <label
                  className={cn(
                    "border-line hover:border-brand text-mist hover:text-brand grid h-32 w-24 place-items-center rounded-md border border-dashed text-[0.75rem] transition-colors",
                    uploading ? "cursor-wait opacity-60" : "cursor-pointer",
                  )}
                >
                  <span className="text-center leading-tight">
                    {uploading ? `${Math.round(uploadProgress * 100)}%` : <>+<br />{t("pe.add")}</>}
                  </span>
                  <input
                    type="file"
                    accept={ACCEPT_ATTRIBUTE}
                    multiple
                    disabled={uploading}
                    onChange={(event) => handleFiles(event.target.files)}
                    className="sr-only"
                  />
                </label>
              </div>

              {uploadError && (
                <p role="alert" className="text-alert mt-3 text-[0.8125rem]">
                  {uploadError}
                </p>
              )}

              {images.length === 0 && !uploading && (
                <p className="text-mist mt-3 text-[0.8125rem]">
                  No imagery yet. A product without an image still lists, but it
                  will not sell.
                </p>
              )}
            </Panel>
          )}

          {/*
            Designs — the artwork axis.

            Variable products only: a simple product is one trade item, and an
            embroidery picker on it would promise a choice the order cannot
            carry.
          */}
          {product && draft.type === "variable" && (
            <Panel
              title={t("pe.designs")}
              description={t("pe.designsHint")}
            >
              {designs.length === 0 && (
                <p className="text-mist text-[0.8125rem]">
                  None. Add one only if this product genuinely sells several
                  artworks — a single-design product needs no picker.
                </p>
              )}

              {designs.length > 0 && (
                <ul className="divide-line divide-y">
                  {designs.map((design, index) => (
                    <li key={design.id} className="flex items-center gap-3 py-3">
                      <span className="bg-paper-sunken rounded-sm relative h-12 w-12 shrink-0 overflow-hidden">
                        <Image
                          src={design.thumbnail.url}
                          alt=""
                          fill
                          sizes="48px"
                          className="object-cover"
                        />
                      </span>

                      <span className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
                        <input
                          value={design.name.en}
                          onChange={(e) =>
                            patchDesign(design.id, {
                              name: { ...design.name, en: e.target.value },
                            })
                          }
                          aria-label={`English name for design ${index + 1}`}
                          className="border-line focus:border-brand bg-paper rounded-sm border px-2 py-1 text-[0.8125rem] outline-none"
                        />
                        <input
                          value={design.name.ar}
                          dir="rtl"
                          onChange={(e) =>
                            patchDesign(design.id, {
                              name: { ...design.name, ar: e.target.value },
                            })
                          }
                          aria-label={`Arabic name for design ${index + 1}`}
                          className="border-line focus:border-brand bg-paper rounded-sm border px-2 py-1 text-[0.8125rem] outline-none"
                        />
                      </span>

                      <label className="shrink-0 text-center">
                        <span className="text-mist block text-[0.625rem] tracking-[0.1em] uppercase">
                          +/- JOD
                        </span>
                        <input
                          type="number"
                          step={step}
                          value={design.priceDelta ?? 0}
                          onChange={(e) =>
                            patchDesign(design.id, { priceDelta: Number(e.target.value) || 0 })
                          }
                          className="border-line focus:border-brand bg-paper w-20 rounded-sm border px-2 py-1 text-center text-[0.75rem] tabular-nums outline-none"
                        />
                      </label>

                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveDesign(index, -1)}
                          disabled={index === 0}
                          aria-label={t("pe.moveUp")}
                          className="text-mist hover:text-ink cursor-pointer px-1 disabled:opacity-25"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveDesign(index, 1)}
                          disabled={index === designs.length - 1}
                          aria-label={t("pe.moveDown")}
                          className="text-mist hover:text-ink cursor-pointer px-1 disabled:opacity-25"
                        >
                          ↓
                        </button>
                        {design.available === false ? (
                          <button
                            type="button"
                            onClick={() => patchDesign(design.id, { available: true })}
                            className="text-brand cursor-pointer px-2 text-[0.75rem] underline-offset-4 hover:underline"
                          >
                            {t("pe.restore")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => withdrawDesign(design.id)}
                            title={t("pe.retireHint")}
                            className="text-mist hover:text-alert cursor-pointer px-2 text-[0.75rem] underline-offset-4 hover:underline"
                          >
                            {t("pe.withdraw")}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <label
                className={cn(
                  "border-line hover:border-brand text-ink-muted hover:text-brand rounded-pill mt-4 inline-block border px-4 py-2 text-[0.8125rem]",
                  designBusy ? "cursor-wait opacity-60" : "cursor-pointer",
                )}
              >
                {designBusy ? "Uploading…" : "Add a design"}
                <input
                  type="file"
                  accept="image/*"
                  disabled={designBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void addDesign(file);
                  }}
                  className="sr-only"
                />
              </label>

              {designs.length > 0 && (
                <p className="text-mist mt-3 text-[0.75rem]">
                  Withdrawn designs stay on past orders and invoices. Stock is
                  per design below — a design with no stock rows reads as sold
                  out on the storefront.
                </p>
              )}
            </Panel>
          )}

          {/* A simple product has no matrix to show. An empty variants table
              under a "Stock is held per variant" heading reads as data that
              failed to load, rather than a product type that has none. */}
          {/*
            Options and their units. No longer gated on `product` existing:
            choosing colours and sizes is part of writing a product, and making
            a merchant save an empty shell first before they can say what they
            are selling is the wrong order.
          */}
          {draft.type === "variable" && (
            <Panel title={t("pe.variants")} description={t("pe.variantsHint")}>
              <div className="mb-6">
                <OptionsEditor
                  baseSku={draft.sku || draft.slug}
                  colors={colors}
                  sizes={sizes}
                  designs={designs}
                  variants={variants}
                  onColorsChange={setColors}
                  onSizesChange={setSizes}
                  onVariantsChange={setVariants}
                />
              </div>
            </Panel>
          )}

          {product && draft.type === "variable" && variants.length > 0 && (
            <Panel title={t("pe.variants")} description={t("pe.variantsHint")}>
              {/*
                One design's table at a time. A colour × size × design cube
                rendered flat is forty inputs with no headings a person can
                follow; picking the artwork first turns it back into the grid
                the merchant already knows.
              */}
              {designs.length > 0 && (
                <div
                  className="ns-no-scrollbar mb-4 flex gap-2 overflow-x-auto"
                  role="group"
                  aria-label={t("pe.designBeingEdited")}
                >
                  {designs.map((design) => (
                    <button
                      key={design.id}
                      type="button"
                      onClick={() => setGridDesignId(design.id)}
                      aria-pressed={gridDesignId === design.id}
                      className={cn(
                        "rounded-pill shrink-0 cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors",
                        gridDesignId === design.id
                          ? "border-ink bg-ink text-white"
                          : "border-line text-ink-muted hover:border-ink/40",
                        design.available === false && "opacity-45",
                      )}
                    >
                      {design.name.en || design.id}
                      {design.available === false && " (withdrawn)"}
                    </button>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]">
                  <thead>
                    <tr className="text-mist text-[0.625rem] tracking-[0.12em] uppercase">
                      <th className="pb-2 text-start font-medium">{t("pe.colour")}</th>
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
                        {product.sizes.map((size) => {
                          const variant = variantAt(color.id, size.id, gridDesignId);
                          return (
                            <td key={size.id} className="py-2.5 text-center">
                              <input
                                type="number"
                                min={0}
                                value={variant?.stock ?? 0}
                                disabled={!variant}
                                aria-label={`Stock for ${color.name.en} ${size.label}${
                                  gridDesignId ? ` ${gridDesignId}` : ""
                                }`}
                                title={variant ? variant.sku : "This permutation is not sold"}
                                onChange={(event) =>
                                  setVariantStock(
                                    color.id,
                                    size.id,
                                    gridDesignId,
                                    Number(event.target.value),
                                  )
                                }
                                className="border-line focus:border-brand bg-paper w-14 rounded-sm border px-2 py-1 text-center text-[0.75rem] tabular-nums outline-none disabled:opacity-30"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-mist mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem]">
                <span>
                  {t("pe.totalAcross")}{" "}
                  <strong className="text-ink tabular-nums">
                    {variants.reduce((sum, v) => sum + v.stock, 0)}
                  </strong>
                  {/* Named explicitly: with designs on screen, an unqualified
                      "total" reads as the total of the table being looked at,
                      which it is not. */}
                </span>
                <span>
                  {/* The product's own total is derived server-side from these
                      rows, so the two can never disagree. */}
                  {t("pe.savedWithProduct")}
                </span>
              </p>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title={t("pe.pricing")}>
            <div className="grid gap-4">
              <NumberField
                label={t("pe.price")}
                value={draft.price}
                onChange={(v) => set("price", v)}
                step={step}
                hint={`${formatPrice(draft.price || 0, "JOD")} — the dinar carries three decimals`}
              />
              <NumberField
                label={t("pe.compareAt")}
                value={draft.compareAtPrice === "" ? 0 : draft.compareAtPrice}
                onChange={(v) => set("compareAtPrice", v === 0 ? "" : v)}
                step={step}
                hint={t("pe.compareAtHint")}
              />
            </div>
          </Panel>

          <Panel title={t("pe.organisation")}>
            <div className="grid gap-4">
              <Field label={t("pe.slug")} value={draft.slug} onChange={(v) => set("slug", v)} required mono />

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Category</span>
                <select
                  value={draft.categoryId}
                  onChange={(event) => set("categoryId", event.target.value)}
                  className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
                >
                  {/* Indented by depth so the tree is legible in a flat
                      <select>, and departments are marked as such — filing a
                      product against a department instead of a subcategory is
                      the mistake this list exists to prevent. */}
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {"\u00a0\u00a0".repeat(category.depth)}
                      {category.depth > 0 ? "└ " : ""}
                      {category.name.en}
                      {category.parentId === null ? " (department)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Status</span>
                <select
                  value={draft.status}
                  onChange={(event) => set("status", event.target.value as Product["status"])}
                  className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
                >
                  <option value="draft">{t("pe.statusDraft")}</option>
                  <option value="active">{t("pe.statusActive")}</option>
                  <option value="archived">{t("pe.statusArchived")}</option>
                </select>
              </label>

              <NumberField
                label={t("pe.totalStock")}
                value={draft.totalStock}
                onChange={(v) => set("totalStock", v)}
                step={1}
              />

              <Field
                label={t("pe.tags")}
                value={draft.tags}
                onChange={(v) => set("tags", v)}
                hint={t("pe.tagsHint")}
              />
            </div>
          </Panel>

          <Panel title={t("pe.commerce")}>
            <div className="grid gap-4">
              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Product type</span>
                <select
                  value={draft.type}
                  onChange={(event) => set("type", event.target.value as ProductType)}
                  className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
                >
                  <option value="simple">{t("pe.typeSimple")}</option>
                  <option value="variable">{t("pe.typeVariable")}</option>
                </select>
                <span className="text-mist mt-1.5 block text-[0.6875rem]">
                  {draft.type === "simple"
                    ? "Stock, SKU and GTIN live on the product. No swatches or size grid are shown."
                    : "Each colour × size is its own variant with its own SKU, GTIN and stock."}
                </span>
              </label>

              <Field
                label={t("pe.sku")}
                value={draft.sku}
                onChange={(v) => set("sku", v)}
                mono
                hint={
                  draft.type === "variable"
                    ? "Parent style code. Variants get their own SKU."
                    : "The code this product ships and invoices under."
                }
              />

              {/* GTIN belongs on the trade item. For a variable product that is
                  the variant, not the parent — so the field is only offered
                  where it can be correct. */}
              {draft.type === "simple" && (
                <div>
                  <Field
                    label={t("pe.gtin")}
                    value={draft.gtin}
                    onChange={(v) => set("gtin", v)}
                    mono
                    hint={t("pe.gtinHint")}
                  />
                  {draft.gtin.trim() !== "" && (
                    <p
                      className={cn(
                        "mt-1.5 text-[0.6875rem]",
                        isValidGtin(draft.gtin.trim()) ? "text-mint" : "text-alert",
                      )}
                    >
                      {isValidGtin(draft.gtin.trim())
                        ? `Valid ${gtinKind(draft.gtin.trim())}.`
                        : "Check digit does not match — marketplaces will reject this."}
                    </p>
                  )}
                </div>
              )}

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Shipping class</span>
                <select
                  value={draft.shippingClassId}
                  onChange={(event) => set("shippingClassId", event.target.value)}
                  className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
                >
                  {shippingClasses.length === 0 && <option value="standard">{t("pe.standard")}</option>}
                  {shippingClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name.en}
                    </option>
                  ))}
                </select>
                <span className="text-mist mt-1.5 block text-[0.6875rem]">
                  {shippingClasses.find((c) => c.id === draft.shippingClassId)?.description?.en ??
                    "Decides surcharges and which delivery speeds this product allows."}
                </span>
              </label>

              <NumberField
                label={t("pe.maxPerOrder")}
                value={draft.maxPerOrder === "" ? 0 : draft.maxPerOrder}
                onChange={(v) => set("maxPerOrder", v <= 0 ? "" : v)}
                step={1}
              />
              <p className="text-mist -mt-2 text-[0.6875rem]">
                {draft.maxPerOrder === 1
                  ? "Sold individually — one per order, whatever the stock."
                  : draft.maxPerOrder === ""
                    ? "0 or blank means stock is the only limit."
                    : `Customers may order at most ${draft.maxPerOrder} per order.`}
              </p>

              <Field
                label={t("pe.upsells")}
                value={draft.upsellIds}
                onChange={(v) => set("upsellIds", v)}
                mono
                hint={t("pe.upsellsHint")}
              />

              <Field
                label={t("pe.crossSells")}
                value={draft.crossSellIds}
                onChange={(v) => set("crossSellIds", v)}
                mono
                hint={t("pe.crossSellsHint")}
              />
            </div>
          </Panel>

          {missing.length > 0 && (
            <Panel>
              <p className="text-ink text-[0.8125rem] font-medium">{t("pe.beforePublishing")}</p>
              <ul className="mt-2 space-y-1">
                {missing.map((item) => (
                  <li key={item} className="text-smoke flex items-center gap-2 text-[0.75rem]">
                    <span className="bg-alert h-1.5 w-1.5 rounded-full" aria-hidden="true" />
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
    "border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none transition-colors",
    rtl && "font-arabic text-[0.9375rem]",
    mono && "font-mono",
  );

  return (
    <label className="block">
      <span className="text-ink-muted mb-1.5 flex items-center gap-1.5 text-[0.75rem]">
        {label}
        {required && <span className="text-alert">*</span>}
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
        className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] tabular-nums outline-none transition-colors"
      />
      {hint && <span className="text-mist mt-1 block text-[0.6875rem]">{hint}</span>}
    </label>
  );
}
