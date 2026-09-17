import fs from "node:fs";
import path from "node:path";

import { buildOrderEmail } from "../src/lib/email/order-email";
import { buildCampaignEmail } from "../src/lib/email/campaign-email";
import type { Order } from "../src/types";

/**
 * Render every email to a file, so they can be looked at.
 *
 * An email template is the one thing in a codebase nobody opens twice and
 * everybody receives. Tests pin the rules — escaping, the unsubscribe link, no
 * empty rows — and none of them can tell you the thing is ugly.
 *
 * Deliberately invented data. Nothing here reads the shop's Firestore, so a
 * preview can never end up showing a real customer's name and address on
 * somebody's screen.
 *
 *     npm run preview:emails
 *
 * Writes into `public/demo/emails/`, which the locale middleware already
 * ignores, so the files open directly at `/demo/emails/<name>.html`.
 */

const OUT = path.resolve(__dirname, "..", "public", "demo", "emails");

/* A shop, not the shop. */
const settings = {
  legal: { tradingName: "Net Sale" },
  contact: { email: "hello@netsale.shop", phone: "+962 7 9000 0000" },
  standardDeliveryDays: [2, 4],
  returnWindowDays: 14,
} as never;

const shot = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=240&h=240&fit=crop&auto=format`;

const order = (locale: "ar" | "en"): Order =>
  ({
    id: "demo",
    reference: "NS-7K4M2X",
    uid: "demo",
    email: "sample@example.com",
    locale,
    items: [
      {
        key: "1",
        productId: "p1",
        sku: "NS-COAT-BONE-M",
        slug: "atelier-wool-coat",
        title: { en: "Atelier Wool Coat", ar: "معطف أتيليه صوف" },
        image: { url: shot("1539533018447-63fcce2678e3"), alt: { en: "", ar: "" } },
        colorId: "bone",
        colorName: { en: "Bone", ar: "عظمي" },
        sizeId: "m",
        sizeLabel: "M",
        unitPrice: 189,
        currency: "JOD",
        quantity: 1,
        maxQuantity: 3,
        addedAt: 0,
      },
      {
        key: "2",
        productId: "p2",
        sku: "NS-TEE-SAGE-S",
        slug: "featherweight-cashmere-tee",
        title: { en: "Featherweight Cashmere Tee", ar: "تيشيرت كشمير خفيف" },
        image: { url: shot("1521572163474-6864f9cf17ab"), alt: { en: "", ar: "" } },
        colorId: "sage",
        colorName: { en: "Sage", ar: "مريمية" },
        sizeId: "s",
        sizeLabel: "S",
        unitPrice: 42,
        currency: "JOD",
        quantity: 2,
        maxQuantity: 6,
        addedAt: 0,
      },
      {
        key: "3",
        productId: "p3",
        sku: "NS-BAG-TAN",
        slug: "structured-leather-tote",
        title: { en: "Structured Leather Tote", ar: "حقيبة جلد مهيكلة" },
        // Deliberately missing, to show the swatch a blocked image leaves.
        image: undefined as never,
        colorId: "tan",
        colorName: { en: "Tan", ar: "بني فاتح" },
        sizeId: "",
        sizeLabel: "",
        unitPrice: 215,
        currency: "JOD",
        quantity: 1,
        maxQuantity: 2,
        addedAt: 0,
      },
    ],
    totals: {
      subtotal: 488,
      discount: 48.8,
      shipping: 3,
      tax: 0,
      total: 442.2,
      currency: "JOD",
    },
    shippingAddress: {
      id: "a",
      fullName: locale === "ar" ? "لينا حداد" : "Lina Haddad",
      phone: "+962 7 9000 0000",
      line1: locale === "ar" ? "شارع الرينبو ١٢" : "12 Rainbow Street",
      line2: locale === "ar" ? "الطابق الثالث" : "Third floor",
      city: locale === "ar" ? "عمّان" : "Amman",
      region: locale === "ar" ? "عمّان" : "Amman",
      countryCode: "JO",
      isDefault: true,
    },
    shippingMethod: { id: "std", name: { en: "Standard", ar: "عادي" }, speed: "standard", price: 3 },
    paymentMethod: "cod",
    status: "shipped",
    timeline: [],
    trackingNumber: "JO4471182930",
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Order;

const campaign = (locale: "ar" | "en") =>
  locale === "ar"
    ? {
        subject: "الرفّ الشتوي — حتى ٤٠٪ خصم",
        preheader: "المعاطف والتريكو حتى الأحد.",
        heading: "الرفّ الشتوي، حتى ٤٠٪",
        body: "اخترنا لك أفضل ما في مجموعة الشتاء: معاطف الصوف، التريكو الثقيل، والحقائب الجلدية.\n\nالخصم يسري حتى مساء الأحد، والشحن مجاني للطلبات فوق ١٠٠ دينار.",
        ctaLabel: "تسوّق المجموعة",
        ctaUrl: "https://netsale.shop/ar/shop",
        locale,
        products: [
          { title: "معطف أتيليه صوف", imageUrl: shot("1539533018447-63fcce2678e3"), price: 189, url: "https://netsale.shop/ar/product/atelier-wool-coat" },
          { title: "حقيبة جلد مهيكلة", imageUrl: shot("1584917865442-de89df76afd3"), price: 215, url: "https://netsale.shop/ar/product/structured-leather-tote" },
          { title: "تيشيرت كشمير خفيف", imageUrl: shot("1521572163474-6864f9cf17ab"), price: 42, url: "https://netsale.shop/ar/product/featherweight-cashmere-tee" },
          { title: "فستان تريكو عمودي", price: 129, url: "https://netsale.shop/ar/product/column-knit-dress" },
        ],
      }
    : {
        subject: "The winter rail — up to 40% off",
        preheader: "Coats and knits, until Sunday.",
        heading: "The winter rail, up to 40%",
        body: "We have pulled the best of the winter collection: wool coats, heavy knits, and leather bags.\n\nThe discount runs until Sunday evening, and shipping is free over 100 JOD.",
        ctaLabel: "Shop the collection",
        ctaUrl: "https://netsale.shop/en/shop",
        locale,
        products: [
          { title: "Atelier Wool Coat", imageUrl: shot("1539533018447-63fcce2678e3"), price: 189, url: "https://netsale.shop/en/product/atelier-wool-coat" },
          { title: "Structured Leather Tote", imageUrl: shot("1584917865442-de89df76afd3"), price: 215, url: "https://netsale.shop/en/product/structured-leather-tote" },
          { title: "Featherweight Cashmere Tee", imageUrl: shot("1521572163474-6864f9cf17ab"), price: 42, url: "https://netsale.shop/en/product/featherweight-cashmere-tee" },
          { title: "Column Knit Dress", price: 129, url: "https://netsale.shop/en/product/column-knit-dress" },
        ],
      };

const SAMPLE_UNSUB = "https://netsale.shop/ar/unsubscribe?e=sample%40example.com&t=preview";

function write(name: string, html: string) {
  fs.writeFileSync(path.join(OUT, `${name}.html`), html, "utf8");
  console.log(`  /demo/emails/${name}.html`);
}

fs.mkdirSync(OUT, { recursive: true });
console.log("Rendered:");

for (const locale of ["ar", "en"] as const) {
  for (const event of ["order-received", "order-shipped", "order-delivered"] as const) {
    const email = buildOrderEmail({ event, order: order(locale), settings, locale });
    if (email) write(`${event}-${locale}`, email.html);
  }

  const promo = buildCampaignEmail(campaign(locale), {
    email: "sample@example.com",
    name: locale === "ar" ? "لينا" : "Lina",
    unsubscribeUrl: SAMPLE_UNSUB,
  });
  if (promo) write(`campaign-${locale}`, promo.html);
}
