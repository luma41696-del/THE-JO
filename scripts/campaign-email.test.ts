import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { buildCampaignEmail, paragraphsOf } from "../src/lib/email/campaign-email";
import { buildOrderEmail } from "../src/lib/email/order-email";
import {
  isPlausibleEmail,
  normaliseEmail,
  resolveAudience,
  type Recipient,
} from "../src/lib/admin/campaign-audience";
import type { Order } from "../src/types";

/**
 * Campaign and order emails.
 *
 * Three things are pinned here, and they are the three that hurt somebody real
 * if they break:
 *
 *  1. **A campaign cannot be built without an unsubscribe link.** Not a
 *     warning — nothing to send.
 *  2. **The order email carries no unsubscribe link**, because it is
 *     transactional and a customer must not be able to switch off their own
 *     dispatch notice.
 *  3. **Everything interpolated is escaped.** A customer's own name and a
 *     product title both reach HTML that other people's software renders.
 *
 * Run with:
 *
 *     npm run test:campaign-email
 */

const UNSUB = "https://netsale.shop/ar/unsubscribe?e=a%40b.com&t=tok";

const draft = (over: Partial<Parameters<typeof buildCampaignEmail>[0]> = {}) => ({
  subject: "Winter, half off",
  heading: "The winter rail, half off",
  body: "Coats and knits are down until Sunday.\n\nEverything else stays where it is.",
  locale: "en" as const,
  ...over,
});

/* -------------------------------------------------------------------------- */
/*  The unsubscribe link is structural                                        */
/* -------------------------------------------------------------------------- */

describe("a campaign without a way out is not sent", () => {
  test("no unsubscribe link means no email at all", () => {
    assert.equal(buildCampaignEmail(draft(), { email: "a@b.com" }), undefined);
    assert.equal(
      buildCampaignEmail(draft(), { email: "a@b.com", unsubscribeUrl: "" }),
      undefined,
    );
  });

  test("a non-https unsubscribe link is refused like a missing one", () => {
    for (const bad of [
      "http://netsale.shop/unsubscribe",
      "javascript:alert(1)",
      "not a url",
      "//netsale.shop/x",
    ]) {
      assert.equal(
        buildCampaignEmail(draft(), { email: "a@b.com", unsubscribeUrl: bad }),
        undefined,
        bad,
      );
    }
  });

  test("with one, it is in both the HTML and the text", () => {
    const email = buildCampaignEmail(draft(), { email: "a@b.com", unsubscribeUrl: UNSUB })!;
    assert.ok(email.html.includes(UNSUB.replace(/&/g, "&amp;")), "escaped into the href");
    assert.ok(email.text.includes(UNSUB), "and readable in the text part");
    assert.match(email.html, /Unsubscribe/);
  });

  test("a subject or heading missing is also nothing to send", () => {
    const r = { email: "a@b.com", unsubscribeUrl: UNSUB };
    assert.equal(buildCampaignEmail(draft({ subject: "  " }), r), undefined);
    assert.equal(buildCampaignEmail(draft({ heading: "" }), r), undefined);
  });
});

/* -------------------------------------------------------------------------- */
/*  Escaping                                                                  */
/* -------------------------------------------------------------------------- */

describe("everything interpolated is escaped", () => {
  test("a name is not markup", () => {
    const email = buildCampaignEmail(draft(), {
      email: "a@b.com",
      name: '<img src=x onerror="alert(1)">',
      unsubscribeUrl: UNSUB,
    })!;
    assert.doesNotMatch(email.html, /<img src=x/);
    assert.match(email.html, /&lt;img src=x/);
  });

  test("a heading and body are not markup either", () => {
    const email = buildCampaignEmail(
      draft({ heading: "<script>x</script>", body: "a & b <b>c</b>" }),
      { email: "a@b.com", unsubscribeUrl: UNSUB },
    )!;
    assert.doesNotMatch(email.html, /<script>/);
    assert.match(email.html, /a &amp; b &lt;b&gt;/);
  });

  test("a product title is not markup", () => {
    const email = buildCampaignEmail(
      draft({ products: [{ title: '"><script>x</script>', price: 10 }] }),
      { email: "a@b.com", unsubscribeUrl: UNSUB },
    )!;
    assert.doesNotMatch(email.html, /<script>/);
  });
});

/* -------------------------------------------------------------------------- */
/*  Links and images                                                          */
/* -------------------------------------------------------------------------- */

describe("links the shop did not choose do not render", () => {
  test("a javascript: CTA produces no button", () => {
    const email = buildCampaignEmail(
      draft({ ctaLabel: "Shop", ctaUrl: "javascript:alert(1)" }),
      { email: "a@b.com", unsubscribeUrl: UNSUB },
    )!;
    assert.doesNotMatch(email.html, /javascript:/);
    assert.doesNotMatch(email.html, />Shop</);
  });

  test("an http hero image is dropped rather than downgraded", () => {
    const email = buildCampaignEmail(draft({ heroUrl: "http://example.com/a.jpg" }), {
      email: "a@b.com",
      unsubscribeUrl: UNSUB,
    })!;
    assert.doesNotMatch(email.html, /example\.com/);
  });

  test("a product with no image still gets a tile, not a hole", () => {
    const email = buildCampaignEmail(draft({ products: [{ title: "Wool coat" }] }), {
      email: "a@b.com",
      unsubscribeUrl: UNSUB,
    })!;
    assert.match(email.html, /Wool coat/);
    // The swatch behind a missing or blocked image.
    assert.match(email.html, /background:#efe9dc/);
  });

  test("only four picks are used, however many are passed", () => {
    const products = Array.from({ length: 9 }, (_, i) => ({ title: `Item ${i}` }));
    const email = buildCampaignEmail(draft({ products }), {
      email: "a@b.com",
      unsubscribeUrl: UNSUB,
    })!;
    assert.match(email.html, /Item 3/);
    assert.doesNotMatch(email.html, /Item 4/);
  });
});

test("a blank line starts a paragraph and a wrapped line does not", () => {
  assert.deepEqual(paragraphsOf("one\ntwo\n\nthree"), ["one two", "three"]);
  assert.deepEqual(paragraphsOf("  \n\n  "), []);
});

/* -------------------------------------------------------------------------- */
/*  The order email                                                           */
/* -------------------------------------------------------------------------- */

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "o1",
    reference: "NS-7K4M2X",
    uid: "u1",
    email: "buyer@example.com",
    locale: "en",
    items: [
      {
        key: "k1",
        productId: "p1",
        sku: "SKU-1",
        slug: "wool-coat",
        title: { en: "Wool Coat", ar: "معطف" },
        image: { url: "https://cdn.example.com/a.jpg", alt: { en: "", ar: "" } },
        colorId: "bone",
        colorName: { en: "Bone", ar: "عظمي" },
        sizeId: "m",
        sizeLabel: "M",
        unitPrice: 120,
        currency: "JOD",
        quantity: 2,
        maxQuantity: 5,
        addedAt: 0,
      },
    ],
    totals: { subtotal: 240, discount: 15, shipping: 3, tax: 0, total: 228, currency: "JOD" },
    shippingAddress: {
      id: "a1",
      fullName: "Lina Haddad",
      phone: "+962 7 9000 0000",
      line1: "12 Rainbow Street",
      city: "Amman",
      region: "Amman",
      countryCode: "JO",
      isDefault: true,
    },
    shippingMethod: { id: "std", name: { en: "Standard", ar: "" }, speed: "standard", price: 3 },
    paymentMethod: "cod",
    status: "paid",
    timeline: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as unknown as Order;

const settings = {
  legal: { tradingName: "Net Sale" },
  contact: { email: "hello@netsale.shop", phone: "+962 7 9000 0000" },
  standardDeliveryDays: [2, 4],
  returnWindowDays: 14,
} as never;

describe("the order email carries the bag", () => {
  test("every line, with its options and its line total", () => {
    const email = buildOrderEmail({ event: "order-paid", order: order(), settings })!;
    assert.match(email.html, /Wool Coat/);
    assert.match(email.html, /Bone · M/);
    // 120 × 2, not the unit price.
    assert.match(email.html, /240\.000/);
    assert.match(email.html, /× 2/);
  });

  test("a quantity of one is not written out", () => {
    const one = order({
      items: [{ ...order().items[0]!, quantity: 1 }],
    });
    const email = buildOrderEmail({ event: "order-paid", order: one, settings })!;
    assert.doesNotMatch(email.html, /× 1/);
  });

  test("the totals are the order's own, discount included", () => {
    const email = buildOrderEmail({ event: "order-paid", order: order(), settings })!;
    assert.match(email.html, /228\.000/, "the total");
    assert.match(email.html, /15\.000/, "the discount");
  });

  test("a zero discount and a zero tax do not print empty rows", () => {
    const clean = order({
      totals: { subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 100, currency: "JOD" },
    });
    const email = buildOrderEmail({ event: "order-paid", order: clean, settings })!;
    assert.doesNotMatch(email.html, /Discount/);
    assert.doesNotMatch(email.html, /Tax/);
    assert.match(email.html, /Free/, "free shipping is named, not left blank");
  });

  /*
   * Images are blocked by default in most clients. A layout that only works
   * once somebody allows them is broken for most of the people who open it.
   */
  test("a line with no image keeps its cell", () => {
    const noImage = order({
      items: [{ ...order().items[0]!, image: undefined as never }],
    });
    const email = buildOrderEmail({ event: "order-paid", order: noImage, settings })!;
    assert.match(email.html, /Wool Coat/);
    assert.match(email.html, /width:64px;height:64px/);
  });

  test("tracking appears only when there is one", () => {
    const without = buildOrderEmail({ event: "order-shipped", order: order(), settings })!;
    assert.doesNotMatch(without.html, /Tracking number/);
    assert.doesNotMatch(without.html, /undefined/);

    const with_ = buildOrderEmail({
      event: "order-shipped",
      order: order({ trackingNumber: "JO123456789" }),
      settings,
    })!;
    assert.match(with_.html, /JO123456789/);
  });

  /*
   * The one rule that separates this from a campaign. Somebody who bought
   * something is owed the dispatch notice whatever they think of the
   * newsletter.
   */
  test("there is no unsubscribe link on a transactional email", () => {
    for (const event of ["order-received", "order-paid", "order-shipped", "order-delivered"] as const) {
      const email = buildOrderEmail({ event, order: order(), settings })!;
      assert.doesNotMatch(email.html, /unsubscribe/i, event);
      assert.doesNotMatch(email.text, /unsubscribe/i, event);
    }
  });

  test("a product title from the catalogue is escaped", () => {
    const nasty = order({
      items: [{ ...order().items[0]!, title: { en: "<script>x</script>", ar: "x" } }],
    });
    const email = buildOrderEmail({ event: "order-paid", order: nasty, settings })!;
    assert.doesNotMatch(email.html, /<script>/);
  });

  test("Arabic renders right-to-left with the reference kept LTR", () => {
    const email = buildOrderEmail({
      event: "order-paid",
      order: order({ locale: "ar" }),
      settings,
      locale: "ar",
    })!;
    assert.match(email.html, /dir="rtl"/);
    // `NS-7K4M2X` inside an Arabic paragraph is reordered into nonsense by
    // bidi unless it is isolated.
    assert.match(email.html, /dir="ltr"[^>]*>NS-7K4M2X|NS-7K4M2X/);
    assert.match(email.subject, /[؀-ۿ]/);
  });

  test("every message names the order and has a text part", () => {
    for (const event of ["order-received", "order-paid", "order-shipped", "order-refunded"] as const) {
      const email = buildOrderEmail({ event, order: order(), settings })!;
      assert.match(email.subject + email.text, /NS-7K4M2X/, event);
      assert.ok(email.text.length > 80, `${event} has a real text alternative`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Who a campaign reaches                                                    */
/* -------------------------------------------------------------------------- */

const person = (email: string, over: Partial<Recipient> = {}): Recipient => ({
  email,
  locale: "ar",
  source: "account",
  ...over,
});

describe("the audience respects an unsubscribe", () => {
  test("a suppressed address is not a recipient", () => {
    const { recipients, suppressedCount } = resolveAudience(
      [person("a@x.com"), person("b@x.com")],
      ["b@x.com"],
    );
    assert.deepEqual(
      recipients.map((r) => r.email),
      ["a@x.com"],
    );
    assert.equal(suppressedCount, 1);
  });

  test("suppression is case-insensitive in both directions", () => {
    const { recipients } = resolveAudience([person("Lina@X.com")], ["lina@x.com"]);
    assert.deepEqual(recipients, []);

    const other = resolveAudience([person("lina@x.com")], ["LINA@X.COM"]);
    assert.deepEqual(other.recipients, []);
  });

  /*
   * One person with an account and a newsletter row is one person. Counting
   * them twice bills the shop twice and puts two copies in one inbox.
   */
  test("an address in both collections is one recipient", () => {
    const { recipients, found } = resolveAudience(
      [person("a@x.com", { source: "subscriber" }), person("A@x.com", { name: "Lina" })],
      [],
    );
    assert.equal(found, 1);
    assert.equal(recipients.length, 1);
    // The account wins: it is the copy that carries a name and a locale.
    assert.equal(recipients[0]!.name, "Lina");
    assert.equal(recipients[0]!.source, "account");
  });

  test("deduplication happens before suppression, so one check covers both", () => {
    const { recipients } = resolveAudience(
      [person("a@x.com", { source: "subscriber" }), person("a@x.com")],
      ["a@x.com"],
    );
    assert.deepEqual(recipients, [], "neither copy survives");
  });

  test("an unusable address is dropped rather than sent to", () => {
    const { recipients } = resolveAudience(
      [person(""), person("not-an-email"), person("a@x.com")],
      [],
    );
    assert.deepEqual(
      recipients.map((r) => r.email),
      ["a@x.com"],
    );
  });

  test("normalising lowercases and trims, and nothing else", () => {
    assert.equal(normaliseEmail("  Lina@X.COM "), "lina@x.com");
    // Stripping +tags would be one provider's rule applied to every provider.
    assert.equal(normaliseEmail("lina+news@x.com"), "lina+news@x.com");
    assert.ok(isPlausibleEmail("lina+news@x.com"));
    assert.ok(!isPlausibleEmail("lina@x"));
  });
});
