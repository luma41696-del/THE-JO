import { formatPrice, t as tr } from "@/lib/format";
import { paymentLabel } from "@/lib/payments";
import { lineOptions } from "@/lib/product";
import type { Locale, Order } from "@/types";

/**
 * Receipts for a point-of-sale printer.
 *
 * A thermal printer is not a small A4 printer, and treating it as one is how
 * receipts come out unreadable. Four things are different, and every rule
 * below follows from one of them:
 *
 *  - **The paper is a roll, not a page.** There is no page height to fit
 *    inside and no page break to avoid; the receipt is exactly as long as it
 *    is. That is `@page { size: <width> auto }`, and it is the single most
 *    important line in the print stylesheet.
 *  - **It has no greyscale.** Every dot is on or off. A grey caption dithers
 *    into a smear, and a filled background prints as a solid black bar that
 *    wastes heat and shortens the head's life. Everything is black on white.
 *  - **It is about 203 dpi, and narrow.** 80mm paper prints about 72mm wide,
 *    58mm prints about 48mm. That is roughly 32 characters of monospace on the
 *    wide roll and 22 on the narrow one, which is what decides how much of a
 *    product name can survive.
 *  - **Nobody reads it twice.** It is scanned at a counter in a second, so the
 *    reference and the total are the two things that have to be unmissable.
 *
 * The rules here are pure so they can be tested without a printer; the
 * component is the surface.
 */

/* -------------------------------------------------------------------------- */
/*  Paper                                                                     */
/* -------------------------------------------------------------------------- */

export type PaperWidth = "80mm" | "58mm";

export interface Paper {
  id: PaperWidth;
  /** What `@page size` gets. The roll's full width. */
  width: string;
  /** The printable strip inside it — thermal heads do not reach the edges. */
  printable: string;
  /** Monospace columns that fit across `printable` at the body size. */
  columns: number;
  label: string;
}

/**
 * The two rolls a shop actually buys.
 *
 * 80mm is the counter standard and 58mm is the handheld and mobile-printer
 * standard. Nothing else is offered because nothing else is common, and a
 * free-text width would let somebody set 73mm and discover it at the counter.
 */
export const PAPERS: Record<PaperWidth, Paper> = {
  "80mm": { id: "80mm", width: "80mm", printable: "72mm", columns: 32, label: "80 mm" },
  "58mm": { id: "58mm", width: "58mm", printable: "48mm", columns: 22, label: "58 mm" },
};

export function paperFor(width: string | null | undefined): Paper {
  return width === "58mm" ? PAPERS["58mm"] : PAPERS["80mm"];
}

/* -------------------------------------------------------------------------- */
/*  Fitting text to a narrow strip                                            */
/* -------------------------------------------------------------------------- */

/**
 * Trim a name to what the roll can hold, on a word boundary where possible.
 *
 * Breaking mid-word on a 22-column receipt produces "Sculpted Should" and the
 * packer has to guess; cutting at the last space and marking it with an
 * ellipsis at least says that something was cut. Arabic is measured the same
 * way — these are visual columns, and the browser reorders the run correctly
 * either way.
 */
export function fitToColumns(text: string, columns: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= columns) return clean;

  const cut = clean.slice(0, columns - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on a space that leaves something worth reading. A name whose
  // first word is longer than the paper has to be cut mid-word regardless.
  const body = lastSpace > columns / 2 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/* -------------------------------------------------------------------------- */
/*  The receipt itself                                                        */
/* -------------------------------------------------------------------------- */

export interface ReceiptLine {
  name: string;
  /** Colour, size, artwork, capacity — whatever this permutation is. */
  options: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  total: string;
}

export interface ReceiptTotal {
  label: string;
  value: string;
  /** The one the customer checks. Printed heavier and boxed. */
  emphasis?: boolean;
}

export interface Receipt {
  reference: string;
  placedAt: number;
  lines: ReceiptLine[];
  totals: ReceiptTotal[];
  /** Units across the whole order — what the packer counts against. */
  units: number;
  payment: string;
  delivery: string;
  customer: { name: string; phone?: string; city?: string };
}

const WORDS = {
  subtotal: { en: "Subtotal", ar: "المجموع" },
  discount: { en: "Discount", ar: "الخصم" },
  shipping: { en: "Delivery", ar: "التوصيل" },
  tax: { en: "Tax", ar: "الضريبة" },
  total: { en: "TOTAL", ar: "الإجمالي" },
} as const;

/**
 * An order, reduced to what goes on the roll.
 *
 * Money is formatted here rather than in the component so the column of
 * amounts is built once and cannot end up half-localised. A zero discount or a
 * zero tax is left out entirely: a line that says "Discount 0.000" is noise on
 * paper that costs money per millimetre.
 */
export function buildReceipt(order: Order, locale: Locale, paper: Paper): Receipt {
  const money = (value: number) => formatPrice(value, order.totals.currency, locale);

  const lines: ReceiptLine[] = order.items.map((item) => ({
    // Two columns are given to the quantity and the amount, so the name gets
    // what is left rather than the full width.
    name: fitToColumns(tr(item.title, locale), paper.columns - 10),
    options: fitToColumns(lineOptions(item, locale).join(" · "), paper.columns - 4),
    sku: item.sku,
    quantity: item.quantity,
    unitPrice: money(item.unitPrice),
    total: money(item.unitPrice * item.quantity),
  }));

  const totals: ReceiptTotal[] = [
    { label: tr(WORDS.subtotal, locale), value: money(order.totals.subtotal) },
  ];
  if (order.totals.discount > 0) {
    totals.push({ label: tr(WORDS.discount, locale), value: `−${money(order.totals.discount)}` });
  }
  if (order.totals.shipping > 0) {
    totals.push({ label: tr(WORDS.shipping, locale), value: money(order.totals.shipping) });
  }
  if (order.totals.tax > 0) {
    totals.push({ label: tr(WORDS.tax, locale), value: money(order.totals.tax) });
  }
  totals.push({ label: tr(WORDS.total, locale), value: money(order.totals.total), emphasis: true });

  const address = order.shippingAddress;

  return {
    reference: order.reference,
    placedAt: order.createdAt,
    lines,
    totals,
    units: order.items.reduce((sum, item) => sum + item.quantity, 0),
    // The customer-facing name, not the internal id. A receipt reading
    // "apple-pay" is the sort of detail that makes a shop look unfinished to
    // the one person holding proof of what they paid.
    payment: paymentLabel(order.paymentMethod, locale),
    delivery: tr(order.shippingMethod.name, locale),
    customer: {
      name: (address?.fullName ?? "").trim(),
      ...(address?.phone ? { phone: address.phone } : {}),
      ...(address?.city ? { city: address.city } : {}),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Code 128                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The order reference, as bars a counter scanner can read.
 *
 * Encoded here rather than pulled from a library: Code 128 subset B is a
 * lookup table and a weighted checksum, the whole thing is the sixty lines
 * below, and a barcode dependency would be a megabyte to draw eight
 * characters. It also has to be *pure* — a barcode that silently encodes the
 * wrong reference is worse than none, because nobody proofreads bars.
 *
 * Subset B because a reference like `NS-7K4M2X` is upper-case letters, digits
 * and a hyphen; subset C would be denser but only encodes digit pairs.
 */

/** Bar widths per symbol, as digit strings. Index is the Code 128 value. */
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "233111", "200000",
] as const;

const START_B = 104;
const STOP = 106;

/** Characters subset B can carry: ASCII 32–126. */
export function code128Encodable(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 32 && code <= 126;
  });
}

export interface Barcode {
  /** Alternating bar/space widths in modules, starting with a bar. */
  bars: number[];
  /** Total width in modules, for the SVG viewBox. */
  modules: number;
  text: string;
}

/**
 * Code 128-B for `text`, or `undefined` when it cannot be encoded.
 *
 * Undefined rather than a blank barcode: a receipt with an empty white box
 * where the bars should be tells the operator something is wrong, whereas a
 * barcode that scans as nothing wastes their time at the counter first.
 */
export function code128(text: string): Barcode | undefined {
  if (!code128Encodable(text)) return undefined;

  const values: number[] = [START_B];
  for (const ch of text) values.push(ch.charCodeAt(0) - 32);

  /*
   * The checksum is a position-weighted sum mod 103, and the start character
   * counts as position zero with weight one. Getting the weighting off by one
   * produces a barcode that looks perfect and scans as nothing.
   */
  let checksum = START_B;
  for (let i = 1; i < values.length; i += 1) checksum += values[i]! * i;
  values.push(checksum % 103);
  values.push(STOP);

  const bars: number[] = [];
  for (const value of values) {
    const pattern = CODE128_PATTERNS[value];
    if (!pattern) return undefined;
    for (const width of pattern) bars.push(Number(width));
  }
  // The stop symbol carries a final two-module bar that its pattern omits.
  bars.push(2);

  return { bars, modules: bars.reduce((sum, w) => sum + w, 0), text };
}
