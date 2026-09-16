import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

process.env.NEXT_PUBLIC_SITE_URL ??= "https://netsale.shop";

import {
  breadcrumbList,
  collectionPageJsonLd,
  itemListJsonLd,
  listingDescription,
  listingTitle,
  productCrumbs,
  websiteJsonLd,
} from "../src/lib/seo";
import type { Category, Product } from "../src/types";

/**
 * Structured data, and the ways it goes wrong quietly.
 *
 * Markup that disagrees with the page costs a site its rich results
 * altogether, and every failure mode here is one that *validates* — a relative
 * URL, a breadcrumb pointing at itself, a list claiming products the page does
 * not show. None of them throws; they just stop working.
 *
 * Run with:
 *
 *     npm run test:seo
 */

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "wool-coat",
    title: { en: "Wool Coat", ar: "معطف صوف" },
    description: { en: "Warm.", ar: "دافئ." },
    categoryId: "outerwear-coats",
    categoryPath: ["outerwear", "outerwear-coats"],
    type: "simple",
    price: 349,
    currency: "JOD",
    images: [{ url: "https://cdn.test/coat.jpg", alt: "a coat", width: 800, height: 1000 }],
    colors: [],
    sizes: [],
    tags: [],
    badges: [],
    inStock: true,
    totalStock: 4,
    status: "active",
    sku: "NS-ATWOCO",
    publishedAt: 0,
    updatedAt: 0,
    ...over,
  } as Product;
}

const categories: Category[] = [
  { id: "outerwear", slug: "outerwear", name: { en: "Outerwear", ar: "معاطف" } } as Category,
  { id: "outerwear-coats", slug: "coats", name: { en: "Coats", ar: "معاطف طويلة" } } as Category,
];

/* -------------------------------------------------------------------------- */
/*  Breadcrumbs                                                               */
/* -------------------------------------------------------------------------- */

describe("breadcrumbList", () => {
  test("numbers the positions from one", () => {
    const crumbs = breadcrumbList([{ name: "Home", path: "" }, { name: "Coats" }], "en");
    assert.deepEqual(
      crumbs.itemListElement.map((item) => item.position),
      [1, 2],
    );
  });

  test("every URL is absolute", () => {
    /*
     * The classic silent failure: a relative URL validates as present and is
     * useless to a crawler, so the breadcrumb simply never appears.
     */
    const crumbs = breadcrumbList([{ name: "Home", path: "" }, { name: "Coats", path: "shop?category=coats" }], "ar");
    for (const item of crumbs.itemListElement) {
      if ("item" in item) {
        assert.equal(String(item.item).startsWith("https://"), true, `relative: ${item.item}`);
      }
    }
  });

  test("the locale is in the path", () => {
    const crumbs = breadcrumbList([{ name: "الرئيسية", path: "" }], "ar");
    assert.equal(crumbs.itemListElement[0]!.item, "https://netsale.shop/ar");
  });

  test("the last crumb carries no URL, because it is this page", () => {
    // Pointing the current page at itself is how these get written wrongly.
    const crumbs = breadcrumbList([{ name: "Home", path: "" }, { name: "Wool Coat" }], "en");
    assert.equal("item" in crumbs.itemListElement[1]!, false);
  });
});

describe("productCrumbs", () => {
  test("runs home, through the departments, to the product", () => {
    const crumbs = productCrumbs(product(), categories, "en", "Home");
    assert.deepEqual(
      crumbs.map((c) => c.name),
      ["Home", "Outerwear", "Coats", "Wool Coat"],
    );
  });

  test("the category links point at a listing that filters on it", () => {
    const crumbs = productCrumbs(product(), categories, "en", "Home");
    assert.equal(crumbs[1]!.path, "shop?category=outerwear");
  });

  test("the product itself is not a link", () => {
    const crumbs = productCrumbs(product(), categories, "en", "Home");
    assert.equal(crumbs.at(-1)!.path, undefined);
  });

  test("names come from the reader's language", () => {
    const crumbs = productCrumbs(product(), categories, "ar", "الرئيسية");
    assert.deepEqual(crumbs.map((c) => c.name), ["الرئيسية", "معاطف", "معاطف طويلة", "معطف صوف"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Listings                                                                  */
/* -------------------------------------------------------------------------- */

describe("itemListJsonLd", () => {
  test("lists what the page shows, in that order", () => {
    /*
     * The claim being made is about this page. Markup listing forty products
     * on a page showing twelve is exactly the mismatch that costs a site its
     * rich results.
     */
    const list = itemListJsonLd([product(), product({ slug: "tee", title: { en: "Tee", ar: "تي" } })], "en", "Coats");
    assert.equal(list.numberOfItems, 2);
    assert.deepEqual(list.itemListElement.map((i) => i.position), [1, 2]);
    assert.equal(list.itemListElement[1]!.item.name, "Tee");
  });

  test("each product URL is absolute and locale-correct", () => {
    const list = itemListJsonLd([product()], "ar", "معاطف");
    assert.equal(list.itemListElement[0]!.item.url, "https://netsale.shop/ar/product/wool-coat");
  });

  test("an image shipped with the shop is made absolute", () => {
    /*
     * Uploaded imagery is already absolute; seeded assets are site-relative
     * paths. A relative image in JSON-LD is the same silent failure as a
     * relative breadcrumb — it validates, and never loads.
     */
    const seeded = itemListJsonLd(
      [product({ images: [{ url: "/demo/coat.svg", alt: "a", width: 8, height: 10 }] })],
      "en",
      "Coats",
    );
    assert.equal(seeded.itemListElement[0]!.item.image, "https://netsale.shop/demo/coat.svg");
  });

  test("an already-absolute image is left alone", () => {
    const list = itemListJsonLd([product()], "en", "Coats");
    assert.equal(list.itemListElement[0]!.item.image, "https://cdn.test/coat.jpg");
  });

  test("availability follows the real stock", () => {
    const gone = itemListJsonLd([product({ inStock: false })], "en", "Coats");
    assert.equal(
      gone.itemListElement[0]!.item.offers.availability,
      "https://schema.org/OutOfStock",
    );
  });

  test("a product with no image omits the property rather than sending an empty one", () => {
    // An empty `image` is an invalid Product; omitting it is valid and honest.
    const list = itemListJsonLd([product({ images: [] })], "en", "Coats");
    assert.equal("image" in list.itemListElement[0]!.item, false);
  });

  test("an empty listing is an empty list, not a broken one", () => {
    const list = itemListJsonLd([], "en", "Coats");
    assert.equal(list.numberOfItems, 0);
    assert.deepEqual(list.itemListElement, []);
  });
});

describe("collectionPageJsonLd", () => {
  test("carries an absolute URL and the page's language", () => {
    const page = collectionPageJsonLd({
      name: "معاطف",
      description: "معاطف الشتاء",
      path: "shop?category=coats",
      locale: "ar",
    });
    assert.equal(page.url.startsWith("https://netsale.shop/ar/"), true);
    assert.equal(page.inLanguage, "ar-JO");
  });

  test("an absent description is omitted rather than sent empty", () => {
    const page = collectionPageJsonLd({ name: "Coats", description: "", path: "shop", locale: "en" });
    assert.equal("description" in page, false);
  });
});

describe("websiteJsonLd", () => {
  test("the search template points at a URL the site actually serves", () => {
    /*
     * A SearchAction whose template 404s is worse than none: it offers a
     * search box in Google's result that takes people to a broken page.
     */
    const site = websiteJsonLd("en", "net sale");
    assert.equal(
      site.potentialAction.target.urlTemplate,
      "https://netsale.shop/en/shop?q={search_term_string}",
    );
    assert.equal(site.potentialAction["query-input"], "required name=search_term_string");
  });
});

/* -------------------------------------------------------------------------- */
/*  Titles                                                                    */
/* -------------------------------------------------------------------------- */

describe("listingTitle", () => {
  test("a category page is titled for its category", () => {
    /*
     * Every filtered listing used to share one title, "Shop" — so a category,
     * a colour and a search result were indistinguishable in history, in a
     * shared link, and to a crawler, which treats a hundred URLs under one
     * title as duplicates and indexes none.
     */
    assert.equal(
      listingTitle({ categoryName: "Coats", fallback: "Shop", locale: "en" }),
      "Coats",
    );
  });

  test("one colour reads in front of the noun", () => {
    assert.equal(
      listingTitle({ categoryName: "Coats", colorNames: ["Cobalt"], fallback: "Shop", locale: "en" }),
      "Cobalt Coats",
    );
  });

  test("several colours are left out rather than listed", () => {
    // "Cobalt and bone and sand coats" is worse than "Coats".
    assert.equal(
      listingTitle({
        categoryName: "Coats",
        colorNames: ["Cobalt", "Bone", "Sand"],
        fallback: "Shop",
        locale: "en",
      }),
      "Coats",
    );
  });

  test("a search names what was searched for", () => {
    assert.equal(
      listingTitle({ searchTerm: "معطف", fallback: "Shop", locale: "ar" }),
      "نتائج البحث عن «معطف»",
    );
    assert.equal(listingTitle({ searchTerm: "coat", fallback: "Shop", locale: "en" }), "Search: coat");
  });

  test("a search wins over a category, because it is what the page is", () => {
    assert.equal(
      listingTitle({ categoryName: "Coats", searchTerm: "wool", fallback: "Shop", locale: "en" }),
      "Search: wool",
    );
  });

  test("a sale is said so", () => {
    assert.equal(
      listingTitle({ categoryName: "Coats", onSale: true, fallback: "Shop", locale: "en" }),
      "Coats on sale",
    );
  });

  test("with nothing selected it falls back", () => {
    assert.equal(listingTitle({ fallback: "Shop", locale: "en" }), "Shop");
  });

  test("the Arabic word order puts the noun first", () => {
    assert.equal(
      listingTitle({ categoryName: "معاطف", colorNames: ["كوبالت"], fallback: "المتجر", locale: "ar" }),
      "معاطف كوبالت",
    );
  });
});

describe("listingDescription", () => {
  test("the category's own words win when it has them", () => {
    assert.equal(
      listingDescription({
        categoryDescription: "Coats cut for an Amman winter.",
        count: 4,
        categoryName: "Coats",
        fallback: "Shop",
        locale: "en",
      }),
      "Coats cut for an Amman winter.",
    );
  });

  test("otherwise it counts what is really there", () => {
    // "Browse our wide selection" on a category holding two products reads as
    // automated, because it is.
    assert.equal(
      listingDescription({ count: 2, categoryName: "Coats", fallback: "Shop", locale: "en" }),
      "2 pieces in Coats, delivered across Jordan.",
    );
  });

  test("one piece is singular", () => {
    assert.equal(
      listingDescription({ count: 1, categoryName: "Coats", fallback: "Shop", locale: "en" }).includes("1 piece in"),
      true,
    );
  });

  test("with no category it falls back", () => {
    assert.equal(listingDescription({ count: 9, fallback: "Everything", locale: "en" }), "Everything");
  });
});
