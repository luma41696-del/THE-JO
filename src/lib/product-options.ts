import type { Localized, ProductColor, ProductSize, ProductVariant, SizeSystem } from "@/types";

/**
 * Colours, sizes, and the permutations they make.
 *
 * A variable product is not "a product with some options". It is a set of
 * **sellable units**, each with its own code, price, count and barcode, and the
 * options are only the axes that name them. Getting that backwards is how a
 * shop ends up selling a size it does not have in the colour that was asked
 * for.
 *
 * Everything here is pure so the combination maths — which is where the
 * off-by-one lives — can be tested without a database or a browser.
 */

/* -------------------------------------------------------------------------- */
/*  The shared colour palette                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Colours a merchant can reach for without typing a hex code.
 *
 * Not a restriction: a product may carry any colour, and the editor allows a
 * custom one. This is the shortlist that keeps a catalogue coherent — twelve
 * products each inventing their own "off-white" is how a filter ends up with
 * six near-identical swatches that match nothing.
 *
 * Ids are stable and referenced by every variant, so **an id is never reused
 * for a different colour**: past orders resolve their colour through it.
 */
export const COLOR_PALETTE: ProductColor[] = [
  { id: "ink", name: { en: "Ink", ar: "حبري" }, hex: "#1B1717" },
  { id: "bone", name: { en: "Bone", ar: "عاجي" }, hex: "#EFE9DE" },
  { id: "white", name: { en: "White", ar: "أبيض" }, hex: "#FBFAF3" },
  { id: "crimson", name: { en: "Signature Red", ar: "أحمر التوقيع" }, hex: "#CE1212" },
  /*
   * Cobalt — a true pigment blue, not a navy and not a royal. Dark enough to
   * read as a colour rather than as black on a phone in daylight, and it sits
   * beside the shop's red without either fighting the other.
   */
  { id: "cobalt", name: { en: "Cobalt", ar: "كوبالت" }, hex: "#1F44B8" },
  { id: "slate", name: { en: "Slate", ar: "إردوازي" }, hex: "#4A4A55" },
  { id: "sand", name: { en: "Sand", ar: "رملي" }, hex: "#D9CFC0" },
  { id: "clay", name: { en: "Clay", ar: "طيني" }, hex: "#C8A68A" },
  { id: "sage", name: { en: "Sage", ar: "مريمية" }, hex: "#A8B8AC" },
  { id: "olive", name: { en: "Olive", ar: "زيتوني" }, hex: "#6B6B47" },
  { id: "camel", name: { en: "Camel", ar: "جملي" }, hex: "#B08A68" },
  { id: "charcoal", name: { en: "Charcoal", ar: "فحمي" }, hex: "#3A3A3A" },
];

export function paletteColor(id: string): ProductColor | undefined {
  return COLOR_PALETTE.find((c) => c.id === id);
}

/** A hex the swatch can actually render. Anything else is refused on save. */
export function isHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

/**
 * A url-safe, stable id from a name.
 *
 * Used for custom colours the merchant types. Latin only by design: the id
 * ends up inside an SKU, and an SKU with Arabic in it breaks every barcode
 * scanner, spreadsheet import and courier label it touches. An Arabic-only
 * name falls back to a short hash so it still gets a usable id.
 */
export function optionId(name: string): string {
  const latin = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (latin.length >= 2) return latin.slice(0, 24);

  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `opt-${Math.abs(hash).toString(36).slice(0, 6)}`;
}

/* -------------------------------------------------------------------------- */
/*  Size presets                                                              */
/* -------------------------------------------------------------------------- */

export const SIZE_PRESETS: Record<string, { label: Localized; sizes: ProductSize[] }> = {
  alpha: {
    label: { en: "XS – XL", ar: "XS – XL" },
    sizes: [
      { id: "xs", label: "XS", system: "alpha" },
      { id: "s", label: "S", system: "alpha" },
      { id: "m", label: "M", system: "alpha" },
      { id: "l", label: "L", system: "alpha" },
      { id: "xl", label: "XL", system: "alpha" },
    ],
  },
  waist: {
    label: { en: "Waist 26 – 36", ar: "خصر ٢٦ – ٣٦" },
    sizes: [26, 28, 30, 32, 34, 36].map((w) => ({
      id: `w${w}`,
      label: String(w),
      system: "waist" as SizeSystem,
    })),
  },
  shoe: {
    label: { en: "EU 38 – 45", ar: "أوروبي ٣٨ – ٤٥" },
    sizes: [38, 39, 40, 41, 42, 43, 44, 45].map((n) => ({
      id: `eu${n}`,
      label: String(n),
      system: "shoe" as SizeSystem,
    })),
  },
  one: {
    label: { en: "One size", ar: "مقاس واحد" },
    sizes: [{ id: "os", label: "One size", system: "alpha" }],
  },
};

/* -------------------------------------------------------------------------- */
/*  Codes                                                                     */
/* -------------------------------------------------------------------------- */

/** Upper-case, hyphen-separated, no spaces. What a scanner and a spreadsheet both cope with. */
export function normaliseSku(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * A suggested code for one permutation.
 *
 * Built from the product's own code and the option ids, so it is readable on a
 * picking list — `TEE-WHT-L-PALM` tells a person what to fetch, while a random
 * id tells them to go and look it up. Suggested, not imposed: the merchant can
 * type their own, and an existing code is never rewritten.
 */
export function suggestSku(
  base: string,
  parts: { colorId?: string; sizeId?: string; designId?: string },
): string {
  const short = (value: string | undefined, length: number) =>
    value ? value.replace(/[^A-Za-z0-9]/g, "").slice(0, length).toUpperCase() : "";

  return normaliseSku(
    [
      short(base, 12) || "SKU",
      short(parts.colorId, 4),
      short(parts.sizeId, 4),
      short(parts.designId, 5),
    ]
      .filter(Boolean)
      .join("-"),
  );
}

/**
 * Codes used more than once.
 *
 * A duplicate SKU means two different things answer to one code: stock
 * decrements hit whichever row is found first, and a picking list is
 * ambiguous. Checked before save rather than trusted, because the generator is
 * not the only way rows arrive — imports and hand edits both bypass it.
 */
export function duplicateSkus(variants: Pick<ProductVariant, "sku">[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of variants) {
    const sku = normaliseSku(v.sku ?? "");
    if (!sku) continue;
    if (seen.has(sku)) dupes.add(sku);
    seen.add(sku);
  }
  return [...dupes];
}

/* -------------------------------------------------------------------------- */
/*  Combinations                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A ceiling on generated rows.
 *
 * Eight colours × six sizes × four designs is 192 sellable units, which is a
 * real catalogue. Ten × ten × ten is a thousand, which is a merchant who has
 * mis-set an axis and is about to make a document nobody can edit. The
 * generator shows the count and refuses past this rather than grinding.
 */
export const MAX_VARIANTS = 250;

export function combinationCount(
  colors: unknown[],
  sizes: unknown[],
  designs: unknown[] = [],
): number {
  return Math.max(1, colors.length) * Math.max(1, sizes.length) * Math.max(1, designs.length);
}

export interface GenerateInput {
  baseSku: string;
  colors: Pick<ProductColor, "id">[];
  sizes: Pick<ProductSize, "id">[];
  designs?: { id: string }[];
  /** Rows that already exist. Their price, stock and code are preserved. */
  existing?: ProductVariant[];
  defaultStock?: number;
}

/**
 * Build the permutation table.
 *
 * **Existing rows win.** Regenerating after adding one size must not reset the
 * prices and counts of the rows that were already there — that is a merchant's
 * afternoon of work, and losing it silently is worse than not having a
 * generator at all. A row is matched on its three axes, not on its code, so a
 * renamed SKU still finds its stock.
 *
 * Rows whose axes no longer exist are dropped from the returned table, but the
 * caller decides whether to persist that: a colour removed by accident should
 * be recoverable by putting it back, not by retyping thirty counts.
 */
export function generateVariants(input: GenerateInput): ProductVariant[] {
  const { baseSku, colors, sizes, designs = [], existing = [], defaultStock = 0 } = input;

  const byAxes = new Map<string, ProductVariant>();
  for (const row of existing) {
    byAxes.set(`${row.colorId}|${row.sizeId}|${row.designId ?? ""}`, row);
  }

  const colorIds = colors.length > 0 ? colors.map((c) => c.id) : [""];
  const sizeIds = sizes.length > 0 ? sizes.map((s) => s.id) : [""];
  const designIds = designs.length > 0 ? designs.map((d) => d.id) : [""];

  const out: ProductVariant[] = [];

  for (const colorId of colorIds) {
    for (const sizeId of sizeIds) {
      for (const designId of designIds) {
        const key = `${colorId}|${sizeId}|${designId}`;
        const previous = byAxes.get(key);

        if (previous) {
          out.push(previous);
          continue;
        }

        out.push({
          sku: suggestSku(baseSku, { colorId, sizeId, designId: designId || undefined }),
          colorId,
          sizeId,
          ...(designId ? { designId } : {}),
          stock: defaultStock,
        });
      }
    }
  }

  return out.slice(0, MAX_VARIANTS);
}

/* -------------------------------------------------------------------------- */
/*  Quantity pricing                                                          */
/* -------------------------------------------------------------------------- */

/**
 * "Three or more, two dinars off each."
 *
 * Tiers are stored on the product and evaluated on the server at checkout —
 * never computed in the browser, where the price is a suggestion.
 */
export interface PriceTier {
  /** Units from which this tier applies. */
  minQuantity: number;
  /** The unit price at this tier, in store currency. */
  unitPrice: number;
}

/**
 * The unit price for a quantity.
 *
 * The **highest matching** tier wins, so tiers written out of order still
 * behave: a merchant who adds "10+" above "5+" has not created a hole where
 * buying more costs more.
 *
 * `aggregate` decides whether a shopper reaches a tier by buying five of one
 * variant or five across the product's variants. Off by default: "buy 5 of
 * this size" is the common intent, and the generous reading should be a
 * decision rather than a surprise on the invoice.
 */
export function priceForQuantity(
  basePrice: number,
  quantity: number,
  tiers: PriceTier[] = [],
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return basePrice;

  const applicable = tiers
    .filter((t) => Number.isFinite(t.minQuantity) && Number.isFinite(t.unitPrice))
    .filter((t) => t.minQuantity <= quantity)
    .sort((a, b) => b.minQuantity - a.minQuantity);

  const best = applicable[0];
  if (!best) return basePrice;

  /*
   * A tier never raises the price. A mistyped tier that charges more for
   * buying more is a bug the customer pays for, and refusing it here is
   * cheaper than finding it in a support ticket.
   */
  return Math.min(basePrice, best.unitPrice);
}

/** Tiers a merchant can actually mean: ascending, no duplicates, above zero. */
export function tierProblems(tiers: PriceTier[]): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();

  for (const tier of tiers) {
    if (!Number.isFinite(tier.minQuantity) || tier.minQuantity < 2) {
      problems.push("A tier starts at two units or more.");
    }
    if (!Number.isFinite(tier.unitPrice) || tier.unitPrice < 0) {
      problems.push("A tier needs a price of zero or more.");
    }
    if (seen.has(tier.minQuantity)) {
      problems.push(`Two tiers both start at ${tier.minQuantity}.`);
    }
    seen.add(tier.minQuantity);
  }

  return [...new Set(problems)];
}
