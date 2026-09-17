"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { formatPrice, minorUnits, t as pick } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { gtinKind, isValidGtin } from "@/lib/product";
import { ACCEPT_ATTRIBUTE, uploadProductImage } from "@/lib/firebase/upload";
import { MediaLibrary } from "./MediaLibrary";
import { sameAsset, storagePathFromUrl } from "@/lib/media";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import { VariantWorkbench } from "./VariantWorkbench";
import { StockRulesEditor } from "./StockRulesEditor";
import { DeleteProductButton } from "./DeleteProductButton";
import { editableAxes, splitAxes } from "@/lib/variant-matrix";
import type {
  Category,
  Product,
  ProductAttribute,
  ProductColor,
  ProductDesign,
  ProductImage,
  ProductSize,
  ProductType,
  ProductVariant,
  ShippingClass,
  StockPriceRule,
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

/**
 * One file's journey through the uploader.
 *
 * Tracked per file rather than behind a single "uploading" flag, because the
 * merchant drops eight photographs at once and the fourth one fails. One flag
 * turns that into "upload failed" — with three images already uploaded that
 * they cannot see, and five they now have to find again on disk. Each file
 * keeps its own state and its own `File` handle, so the one that failed can be
 * retried on its own.
 */
interface QueuedUpload {
  id: string;
  file: File;
  name: string;
  state: "waiting" | "uploading" | "done" | "failed";
  progress: number;
  error?: string;
}

/**
 * A file the merchant has taken off this product but which is still in Storage.
 *
 * Held until the save lands. Deleting at the moment the × is pressed — which
 * is what this did — breaks a published product the instant the merchant
 * changes their mind, closes the tab, or hits a save conflict: the file is
 * gone and the stored document still points at it.
 */
interface PendingRemoval {
  url: string;
  /** Shown so the merchant can see what is queued to go. */
  alt: string;
}

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
  canDelete = false,
}: {
  product: Product | null;
  categories: Category[];
  shippingClasses?: ShippingClass[];
  /** Deleting is an administrator's job; archiving is the reversible option. */
  canDelete?: boolean;
}) {
  const { t, locale } = useAdminLocale();
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  /*
   * Files taken off this product but not yet deleted. Emptied by the save —
   * never by the ×, which is the whole point. See `removeImage`.
   */
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);

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
  /*
   * The version this form was built from, frozen at mount.
   *
   * Not read from `product` at save time: the prop can be refreshed by a
   * router navigation underneath an open form, and comparing against a value
   * that moved with the document would defeat the check entirely.
   */
  /**
   * Where this session's uploads land.
   *
   * A saved product uses its own id. A new one gets a draft folder, so images
   * can be added before the product exists — the document stores the resulting
   * URL, and nothing depends on the folder name matching an id afterwards.
   */
  const [uploadFolder] = useState(
    () => product?.id ?? `draft-${Math.random().toString(36).slice(2, 10)}`,
  );

  const [loadedAt] = useState<number>(() => product?.updatedAt ?? 0);
  const [conflict, setConflict] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [recovered, setRecovered] = useState(false);

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

  /*
   * Axes beyond colour and size.
   *
   * Seeded from the category when a product has none of its own, then owned by
   * the product — so editing a category's attributes later cannot rewrite the
   * table of everything already filed under it.
   */
  const [attributes, setAttributes] = useState<ProductAttribute[]>(
    () => product?.attributes ?? [],
  );
  const [stockRules, setStockRules] = useState<StockPriceRule[]>(
    product?.stockPriceRules ?? [],
  );
  /*
   * What the variant table shows as columns.
   *
   * Colour, size and design are derived from the product's own arrays rather
   * than duplicated, so the swatch row and the artwork panel stay the single
   * place each is defined and the table cannot drift from them.
   */
  const categoryAttributes = useMemo(
    () => categories.find((category) => category.id === draft.categoryId)?.attributes ?? [],
    [categories, draft.categoryId],
  );

  const axes = useMemo(
    () =>
      editableAxes(
        { colors, sizes, designs },
        // The category's list seeds a product that has none of its own; once
        // it has, the product's own list wins. A category edited next month
        // must not rewrite the columns these rows are keyed on.
        attributes.length > 0 ? attributes : categoryAttributes,
      ),
    [colors, sizes, designs, attributes, categoryAttributes],
  );

  function setAxes(next: ProductAttribute[]) {
    const split = splitAxes(next, { colors, sizes });
    setColors(split.colors);
    setSizes(split.sizes);
    setAttributes(split.custom);
  }

  const [designBusy, setDesignBusy] = useState(false);

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

  /**
   * Add a design from a file.
   *
   * The name and the alt text used to be three stacked `window.prompt` calls
   * before the upload even began — cancel the second and the first was lost.
   * The design arrives with a placeholder name now, and both names and the alt
   * text are editable in the row, where the merchant can see the thumbnail
   * they are naming.
   */
  async function addDesign(file: File) {
    const name = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Design";
    const nameAr = name;

    setDesignBusy(true);
    setUploadError(null);
    try {
      const thumbnail = await uploadProductImage(uploadFolder, file, "");
      const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now()
        .toString(36)
        .slice(-4)}`;
      setDesigns((current) => [
        ...current,
        { id, name: { en: name, ar: nameAr }, thumbnail, available: true, position: current.length },
      ]);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "That thumbnail could not be uploaded.",
      );
    } finally {
      setDesignBusy(false);
    }
  }

  /**
   * Upload one queued file, and put whatever happens back on its own row.
   *
   * A failure leaves the `File` handle in the queue. That is the whole reason
   * the queue exists: the browser will not hand a file back once the input has
   * been cleared, so a failed upload without a retained handle means the
   * merchant has to go and find the photograph again. With it, Retry is one
   * click and no trip to the file manager.
   */
  async function runUpload(item: QueuedUpload) {
    setQueue((current) =>
      current.map((q) =>
        q.id === item.id ? { ...q, state: "uploading", progress: 0, error: undefined } : q,
      ),
    );

    try {
      const uploaded = await uploadProductImage(uploadFolder, item.file, "", {
        onProgress: (fraction) =>
          setQueue((current) =>
            current.map((q) => (q.id === item.id ? { ...q, progress: fraction } : q)),
          ),
      });

      setImages((current) => [...current, uploaded]);
      setQueue((current) =>
        current.map((q) => (q.id === item.id ? { ...q, state: "done", progress: 1 } : q)),
      );

      /*
       * Record it in the library — after the image is on the product, never
       * before, and never as a condition of success. The file is already
       * uploaded and already attached by this point; a library that is one
       * entry behind is a smaller problem than an upload that reports failure
       * after succeeding.
       */
      void registerInLibrary(uploaded, item.file);
    } catch (error) {
      setQueue((current) =>
        current.map((q) =>
          q.id === item.id
            ? {
                ...q,
                state: "failed",
                error: error instanceof Error ? error.message : "That image could not be uploaded.",
              }
            : q,
        ),
      );
    }
  }

  /** Tell the library a file exists. Best effort, by design — see `runUpload`. */
  async function registerInLibrary(image: ProductImage, file: File) {
    try {
      const token = await getIdToken().catch(() => null);
      await fetch("/api/admin/media", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          url: image.url,
          alt: image.alt,
          width: image.width,
          height: image.height,
          bytes: file.size,
          contentType: file.type,
          filename: file.name,
        }),
      });
    } catch {
      /* The image is on the product either way. */
    }
  }

  /**
   * Take the files now, ask for the words after.
   *
   * Two things changed here earlier. It no longer requires a saved product —
   * uploading into a folder named for a draft is fine, because the product
   * stores the resulting *URL* and nothing depends on the folder matching an
   * id. Making a merchant save an empty shell before they can add a photograph
   * was an ordering problem, not a technical one.
   *
   * And it no longer interrogates them through `window.prompt`, once per file,
   * modally, with no way back. Alt text is still required — at *publish*, in a
   * field beside the picture where the merchant can see what they are
   * describing. A blocking prompt asking someone to describe a file they have
   * not looked at yet produces "IMG_4821", which is worse than nothing: a
   * screen reader announces it in full and the listener learns less than from
   * silence.
   */
  async function handleFiles(list: FileList | File[] | null) {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;

    const queued: QueuedUpload[] = files.map((file, index) => ({
      id: `${Date.now().toString(36)}-${index}-${file.name}`,
      file,
      name: file.name,
      state: "waiting",
      progress: 0,
    }));

    setQueue((current) => [...current, ...queued]);
    setUploading(true);

    // One at a time: eight parallel uploads on a shop's connection make all
    // eight slow and the progress bars meaningless.
    for (const item of queued) await runUpload(item);

    setUploading(false);
  }

  /** Retry the ones that failed, keeping the ones that did not. */
  async function retryFailed() {
    const failed = queue.filter((item) => item.state === "failed");
    if (failed.length === 0) return;
    setUploading(true);
    for (const item of failed) await runUpload(item);
    setUploading(false);
  }

  /** Alt text, edited in place against the picture it describes. */
  function setImageAlt(url: string, alt: string) {
    setImages((current) => current.map((img) => (img.url === url ? { ...img, alt } : img)));
  }

  /**
   * Tie a photograph to one colourway, or to all of them.
   *
   * Written as `undefined` rather than an empty string for "all": the
   * storefront asks whether the field is set, and an empty string is a set
   * field that matches no colour — which would hide the image from every
   * colourway instead of showing it in each.
   */
  function setImageColour(url: string, colorId: string) {
    setImages((current) =>
      current.map((img) =>
        img.url === url ? { ...img, colorId: colorId || undefined } : img,
      ),
    );
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

  /**
   * Take an image off this product. Do not delete the file.
   *
   * These were one action, and that was a bug with two faces. Remove an image
   * from a published product, then close the tab without saving or hit a save
   * conflict: the file was already gone from Storage while the stored document
   * still listed its URL — a hole in a live product page, discovered by a
   * customer. And a photograph shared with another product — a size chart, a
   * fabric swatch — was deleted out from under it without a word.
   *
   * Removing is now a change to *this form*, queued like every other change
   * and undoable by not saving. The file is dealt with after the save lands,
   * by a server that can see the whole catalogue — see `reapRemovedFiles`.
   */
  function removeImage(index: number) {
    const image = images[index];
    setImages((current) => current.filter((_, i) => i !== index));
    if (!image) return;
    // Nothing to reap for a seeded asset: there is no object behind it.
    if (!storagePathFromUrl(image.url)) return;
    setPendingRemovals((current) =>
      current.some((pending) => sameAsset(pending.url, image.url))
        ? current
        : [...current, { url: image.url, alt: image.alt }],
    );
  }

  /**
   * Once the save has landed, deal with the files that were taken off.
   *
   * Two guards, in this order. A file the merchant removed and then put back
   * during the same session is not removed at all — the saved document points
   * at it. And the route refuses to delete anything another product still
   * shows, which is a check only the server can make: this form has no idea
   * what the rest of the catalogue holds.
   *
   * A refusal is reported as information, not as a save failure. The save
   * succeeded; the file simply stayed, because something needs it.
   */
  async function reapRemovedFiles(kept: ProductImage[], savedProductId: string | undefined) {
    const queuedForRemoval = pendingRemovals.filter(
      (pending) => !kept.some((image) => sameAsset(image.url, pending.url)),
    );
    setPendingRemovals([]);
    if (queuedForRemoval.length === 0) return;

    const token = await getIdToken().catch(() => null);
    let keptElsewhere = 0;

    for (const pending of queuedForRemoval) {
      try {
        const response = await fetch("/api/admin/media", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ url: pending.url, ignoreProductId: savedProductId }),
        });
        if (response.status === 409) keptElsewhere += 1;
      } catch {
        // The product is saved and correct. An object nobody references costs
        // pennies; failing the save over it would cost the merchant the edit.
      }
    }

    if (keptElsewhere > 0) setUploadError(t("up.keptElsewhere"));
  }
  const [saved, setSaved] = useState(false);

  /* ---- keeping the work ------------------------------------------------ */

  /**
   * Where an unsaved draft lives between visits.
   *
   * Per product, and `new` for one that does not exist yet — two half-written
   * products must not overwrite each other's recovery copy.
   */
  const draftKey = `net-sale:product-draft:${product?.id ?? "new"}`;

  /** Everything the form holds, as one comparable value. */
  const snapshot = useMemo(
    () =>
      JSON.stringify({ draft, images, colors, sizes, variants, designs, stockRules, attributes }),
    [draft, images, colors, sizes, variants, designs, stockRules, attributes],
  );

  const [baseline] = useState(snapshot);
  const dirty = snapshot !== baseline && !saved;

  /*
   * A local copy, written as they type.
   *
   * This is **not** an autosave to the shop — nothing reaches customers, and a
   * half-written product is never published by a timer. It is a recovery copy
   * for the laptop that sleeps, the tab that is closed by accident, and the
   * session that expires mid-edit. The save button remains the only thing that
   * publishes anything.
   */
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({ at: Date.now(), from: loadedAt, snapshot }),
        );
      } catch {
        // Storage full or blocked. The form still works; only recovery is lost.
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [snapshot, dirty, draftKey, loadedAt]);

  /*
   * Offer the recovery copy on the way back in.
   *
   * Only when it is newer than the stored product — a draft from before
   * somebody else's save is stale, and restoring it would undo their work
   * without the merchant realising.
   */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { at: number; from: number; snapshot: string };
      if (parsed.snapshot === baseline) {
        window.localStorage.removeItem(draftKey);
        return;
      }
      if (parsed.from !== loadedAt) {
        // The product moved on since this draft was written.
        window.localStorage.removeItem(draftKey);
        return;
      }
      setRecovered(true);
    } catch {
      /* unreadable copy; ignore it */
    }
    // Runs once on mount: the offer is about what was there before this visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function restoreDraft() {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { snapshot: string };
      const value = JSON.parse(parsed.snapshot) as {
        draft: Draft;
        images: ProductImage[];
        colors: ProductColor[];
        sizes: ProductSize[];
        variants: ProductVariant[];
        designs: ProductDesign[];
      };
      setDraft(value.draft);
      setImages(value.images ?? []);
      setColors(value.colors ?? []);
      setSizes(value.sizes ?? []);
      setVariants(value.variants ?? []);
      setDesigns(value.designs ?? []);
    } catch {
      /* nothing to restore */
    }
    setRecovered(false);
  }

  function discardDraft() {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* nothing to remove */
    }
    setRecovered(false);
  }

  /* The browser's own warning. Ours cannot be styled, and should not be. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const [error, setError] = useState<string | null>(null);

  const isNew = !product;
  const step = 1 / 10 ** minorUnits("JOD");

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  /*
   * What is still needed before this can be *published*.
   *
   * Deliberately not what is needed to save. A merchant writing a product over
   * two sittings has to be able to keep a half-finished draft — refusing the
   * save is how an afternoon of typing gets lost to a closed tab. The
   * requirement lands where it starts costing something: the moment a shopper
   * could see it.
   */
  const missing: string[] = [];
  if (!draft.titleEn.trim()) missing.push("English title");
  if (!draft.titleAr.trim()) missing.push("Arabic title");
  if (!draft.slug.trim()) missing.push("slug");
  if (draft.price <= 0) missing.push("price");
  if (images.length === 0) missing.push("an image");
  if (images.some((image) => !image.alt.trim())) missing.push("a description for every image");

  async function save() {
    /*
     * Publishing is held to the list; saving a draft is not. A draft with
     * nothing but a title is a legitimate thing to keep.
     */
    if (draft.status === "active" && missing.length > 0) {
      setError(`Still needed before publishing: ${missing.join(", ")}.`);
      return;
    }
    if (!draft.titleEn.trim() && !draft.titleAr.trim()) {
      // One name, in either language, so the draft has something to be listed by.
      setError("A draft still needs a name in one language.");
      return;
    }
    // A second click while the first is in flight would write twice and, with
    // a new product, create two.
    if (saving) return;

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
          // The version this form was built from. The route refuses the write
          // if the document has moved on, rather than overwriting silently.
          ...(product ? { expectedUpdatedAt: loadedAt } : {}),
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
          // null clears them; an empty array would read as "leave as they are".
          stockPriceRules: stockRules.length > 0 ? stockRules : null,
          // Same rule for the axes: null is "there are none now", and absent
          // would leave yesterday's columns on a product that no longer uses
          // them.
          ...(draft.type === "variable"
            ? { attributes: attributes.length > 0 ? attributes : null }
            : {}),
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
        conflict?: boolean;
      };
      /*
       * A conflict is not a failure to report as one. The merchant's typing is
       * still on screen and still valid; what changed is that somebody else
       * got there first, and the only safe move is to say so plainly rather
       * than retry into an overwrite.
       */
      if (response.status === 409 || data.conflict) {
        setConflict(true);
        setError(data.error ?? "Someone else saved this while you were editing.");
        return;
      }

      if (!response.ok || !data.ok) throw new Error(data.error ?? "Save failed");

      setSaved(true);
      if (data.persisted === false) {
        setError(
          "Validated but not written — Firebase Admin is not configured, so there is nowhere to save to yet.",
        );
        // Not stored, so the recovery copy stays: it is the only surviving copy.
        return;
      }

      // Written for real, so the recovery copy has done its job.
      setLastSavedAt(Date.now());
      discardDraft();

      /*
       * Only now are the removed files dealt with — after the document that
       * stopped referencing them is actually stored. Doing it any earlier is
       * the bug this replaced.
       */
      void reapRemovedFiles(images, product?.id ?? data.id);

      if (isNew && data.id) {
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
            {/*
              Deliberately a quiet text link, not a button.
              
              It sits beside Save, which is the one thing a merchant presses on
              this screen all day — and the two must not look alike. Archiving
              is the reversible option and lives in the status field; this is
              the one that cannot be undone.
            */}
            {!isNew && canDelete && product && (
              <DeleteProductButton
                productId={product.id}
                slug={product.slug}
                title={draft.titleEn || product.slug}
              />
            )}
            {/*
              The state of the work, next to the button that changes it. A
              merchant who has typed for ten minutes should be able to see
              whether any of it has reached the shop.
            */}
            <span className="text-mist me-1 text-[0.6875rem] whitespace-nowrap">
              {dirty
                ? t("pe.unsaved")
                : lastSavedAt
                  ? `${t("pe.savedAt")} ${new Date(lastSavedAt).toLocaleTimeString(
                      locale === "ar" ? "ar-JO" : "en-GB",
                      { hour: "2-digit", minute: "2-digit" },
                    )}`
                  : ""}
            </span>
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

      {/*
        A recovery copy from a previous visit. Offered, never applied
        automatically: silently replacing what is on screen with an older
        draft is its own kind of data loss.
      */}
      {recovered && (
        <div className="border-line bg-paper-raised mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
          <p className="text-ink-muted text-[0.8125rem]">{t("pe.recovered")}</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={restoreDraft}>
              {t("pe.restoreDraft")}
            </Button>
            <Button variant="ghost" size="sm" onClick={discardDraft}>
              {t("pe.discardDraft")}
            </Button>
          </div>
        </div>
      )}

      {/*
        Somebody else got there first. Reloading is the only safe move, and it
        is offered as a button rather than left as an instruction.
      */}
      {conflict && (
        <div className="bg-alert/10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md p-3">
          <p className="text-alert text-[0.8125rem]">{t("pe.conflict")}</p>
          <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
            {t("pe.reload")}
          </Button>
        </div>
      )}

      {error && !conflict && (
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

          {/*
            No longer gated on a saved product.

            The panel used to render only once the product existed, so a
            merchant creating one was told to save an empty shell first and
            come back for the photographs. Nothing technical required that:
            uploads go to a draft folder and the document stores the resulting
            URL. It was an ordering rule imposed by the form, and it made the
            most natural way to build a product — pictures first — impossible.
          */}
          <Panel
              title={t("pe.imagery")}
              description={t("pe.firstImageHint")}
              actions={
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  className="border-line text-ink-muted hover:border-ink hover:text-ink rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors"
                  data-cursor="hover"
                >
                  {t("media.open")}
                </button>
              }
            >
              {/*
                A drop target around the whole gallery.

                `dragCounter` is not needed because `dragleave` on the
                container fires when the pointer crosses a child, which makes
                the highlight flicker; checking that the pointer actually left
                the element's bounds is steadier than counting events.
              */}
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!dragging) setDragging(true);
                }}
                onDragLeave={(event) => {
                  const next = event.relatedTarget as Node | null;
                  if (!next || !event.currentTarget.contains(next)) setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const dropped = Array.from(event.dataTransfer.files).filter((file) =>
                    file.type.startsWith("image/"),
                  );
                  void handleFiles(dropped);
                }}
                className={cn(
                  "rounded-lg border-2 border-dashed p-3 transition-colors",
                  dragging ? "border-brand bg-brand-mist/40" : "border-transparent",
                )}
              >
              <div className="flex flex-wrap gap-3">
                {images.map((image, index) => (
                  <div key={image.url} className="w-24">
                  <div
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

                  {/*
                    Alt text, beside the picture it describes rather than in a
                    prompt before the upload. A red edge where it is missing:
                    publishing is blocked until every image has one, and the
                    merchant can see at a glance which.
                  */}
                  <input
                    value={image.alt}
                    onChange={(event) => setImageAlt(image.url, event.target.value)}
                    placeholder={t("pe.altPlaceholder")}
                    aria-label={`${t("pe.altPlaceholder")} ${index + 1}`}
                    className={cn(
                      "focus:border-brand bg-paper text-ink placeholder:text-mist mt-1 w-24 rounded-md border px-1.5 py-1 text-[0.625rem] outline-none transition-colors",
                      image.alt.trim() ? "border-line" : "border-alert",
                    )}
                  />

                  {/*
                    Which colourway this shot belongs to.

                    The storefront has always filtered the gallery by colour —
                    `imagesFor` reads `image.colorId` — and nothing had ever
                    written it, so every colour showed every photograph. The
                    data model was right and the door to it was missing.

                    Only offered once there are colours to choose between; on a
                    single-colour product the control would be a question with
                    one answer.
                  */}
                  {colors.length > 0 && (
                    <select
                      value={image.colorId ?? ""}
                      onChange={(event) => setImageColour(image.url, event.target.value)}
                      aria-label={`${t("opt.imageColour")} ${index + 1}`}
                      className="border-line focus:border-brand bg-paper text-ink mt-1 w-24 rounded-md border px-1 py-1 text-[0.625rem] outline-none transition-colors"
                    >
                      <option value="">{t("opt.allColours")}</option>
                      {colors.map((colour) => (
                        <option key={colour.id} value={colour.id}>
                          {pick(colour.name, locale)}
                        </option>
                      ))}
                    </select>
                  )}
                  </div>
                ))}

                <label
                  className={cn(
                    "border-line hover:border-brand text-mist hover:text-brand grid h-32 w-24 place-items-center rounded-md border border-dashed text-center text-[0.75rem] leading-tight transition-colors",
                    uploading ? "cursor-wait opacity-60" : "cursor-pointer",
                  )}
                >
                  <span>
                    +<br />
                    {t("pe.add")}
                    <br />
                    <span className="text-[0.625rem] opacity-70">{t("up.drop")}</span>
                  </span>
                  <input
                    type="file"
                    accept={ACCEPT_ATTRIBUTE}
                    multiple
                    disabled={uploading}
                    onChange={(event) => {
                      void handleFiles(event.target.files);
                      // Cleared so picking the same file again still fires a
                      // change event — the usual case after a failed upload.
                      event.target.value = "";
                    }}
                    className="sr-only"
                  />
                </label>
              </div>

              {/*
                The queue, one row per file.

                Shown while anything is in flight and kept afterwards only for
                the failures, because those are the rows that still need a
                decision. A bare percentage over the whole batch cannot say
                which of eight photographs is the one that did not make it.
              */}
              {queue.some((item) => item.state !== "done") && (
                <ul className="mt-3 grid gap-1.5">
                  {queue
                    .filter((item) => item.state !== "done")
                    .map((item) => (
                      <li
                        key={item.id}
                        className="border-line flex items-center gap-3 rounded-md border px-3 py-2 text-[0.75rem]"
                      >
                        <span className="text-ink min-w-0 flex-1 truncate">{item.name}</span>

                        {item.state === "uploading" && (
                          <span className="text-mist tabular-nums">
                            {Math.round(item.progress * 100)}%
                          </span>
                        )}
                        {item.state === "waiting" && (
                          <span className="text-mist">{t("common.loading")}</span>
                        )}
                        {item.state === "failed" && (
                          <>
                            <span className="text-alert min-w-0 flex-1 truncate" title={item.error}>
                              {item.error}
                            </span>
                            <button
                              type="button"
                              onClick={() => void runUpload(item)}
                              className="border-line hover:border-ink text-ink rounded-pill cursor-pointer border px-2.5 py-1 transition-colors"
                              data-cursor="hover"
                            >
                              {t("up.retry")}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setQueue((current) => current.filter((q) => q.id !== item.id))
                              }
                              className="text-mist hover:text-ink cursor-pointer"
                              data-cursor="hover"
                            >
                              {t("up.dismiss")}
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                </ul>
              )}

              {queue.filter((item) => item.state === "failed").length > 1 && (
                <button
                  type="button"
                  onClick={() => void retryFailed()}
                  className="border-line hover:border-ink text-ink rounded-pill mt-2 cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors"
                  data-cursor="hover"
                >
                  {t("up.retryAll")}
                </button>
              )}

              {/*
                What will happen to the removed files, stated before the save
                rather than discovered after it.
              */}
              {pendingRemovals.length > 0 && (
                <p className="text-mist mt-3 text-[0.75rem]">
                  {t("up.pendingRemoval").replace("{n}", String(pendingRemovals.length))}
                </p>
              )}
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

          {/*
            Designs — the artwork axis.

            Variable products only: a simple product is one trade item, and an
            embroidery picker on it would promise a choice the order cannot
            carry.
          */}
          {draft.type === "variable" && (
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
                  per variant: each artwork is a column in the variant table
                  below, and one with no rows reads as sold out on the
                  storefront.
                </p>
              )}
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


      {/*
        The variant table, full width.
        
        Out of the two-column grid on purpose: this table is as wide as the
        product has axes, and eight columns squeezed into a 1.7fr track is a
        spreadsheet read through a letterbox. Placed after the panels it
        depends on, so the page reads in the order the work happens —
        details, then category, then attributes, then the rows.
      */}
      {draft.type === "variable" && (
        <div className="mt-4">
          <Panel title={t("pe.variants")} description={t("pe.variantsHint")}>
            <VariantWorkbench
              attributes={axes}
              onAttributesChange={setAxes}
              variants={variants}
              onVariantsChange={setVariants}
              productPrice={draft.price}
              baseSku={draft.sku || draft.slug}
            />

            <div className="border-line mt-6 border-t pt-5">
              <StockRulesEditor rules={stockRules} onChange={setStockRules} />
            </div>
          </Panel>
        </div>
      )}

      <MediaLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        alreadyUsed={images.map((image) => image.url)}
        ignoreProductId={product?.id}
        onPick={(picked) =>
          setImages((current) => [
            ...current,
            // Guarded, because the picker can be reopened and the same file
            // chosen twice — two identical entries in a gallery is a bug the
            // merchant then has to find and undo.
            ...picked.filter(
              (image) => !current.some((existing) => sameAsset(existing.url, image.url)),
            ),
          ])
        }
      />
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
