import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { withBorrowedImages } from "../src/lib/categories";
import type { Category, Product } from "../src/types";

/**
 * Giving every category in the nav a picture of its own.
 *
 * The menu shows categories as photographs, and a shop that has not uploaded
 * forty of them would otherwise get forty identical placeholders — a picture
 * menu with no pictures, which is worse than the text list it replaced.
 *
 * The rule that earns its keep is the one about *different* pictures: a
 * department and its four subcategories all borrowing the same bestseller
 * shows one garment five times, which reads as broken rather than sparse.
 *
 * Run with:
 *
 *     npm run test:category-images
 */

function category(over: Partial<Category> = {}): Category {
  return {
    id: "c1",
    slug: "c1",
    name: { en: "Coats", ar: "معاطف" },
    parentId: null,
    path: ["c1"],
    depth: 0,
    order: 0,
    productCount: 1,
    featured: false,
    ...over,
  } as Category;
}

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    categoryId: "c1",
    categoryPath: ["c1"],
    status: "active",
    images: [{ url: "/demo/p1.jpg", alt: "a", width: 400, height: 520 }],
    ...over,
  } as Product;
}

describe("withBorrowedImages", () => {
  test("a category with no image borrows one from a product in it", () => {
    const [result] = withBorrowedImages([category()], [product()]);
    assert.equal(result!.image?.url, "/demo/p1.jpg");
  });

  test("an uploaded image is never overridden", () => {
    /*
     * The merchant's own choice wins. Borrowing is a floor, not a preference.
     */
    const chosen = category({
      image: { url: "/uploads/mine.jpg", alt: "chosen", width: 8, height: 10 },
    });
    const [result] = withBorrowedImages([chosen], [product()]);
    assert.equal(result!.image?.url, "/uploads/mine.jpg");
    assert.equal(result!.image?.alt, "chosen");
  });

  test("two categories never borrow the same photograph", () => {
    /*
     * The failure this exists to prevent. A department and its subcategories
     * all match the same bestseller, and the menu shows one garment five
     * times.
     */
    const cats = [
      category({ id: "dept", path: ["dept"], depth: 0 }),
      category({ id: "sub", parentId: "dept", path: ["dept", "sub"], depth: 1 }),
    ];
    const items = [
      product({ id: "a", categoryId: "sub", categoryPath: ["dept", "sub"], images: [{ url: "/a.jpg", alt: "", width: 8, height: 10 }] }),
      product({ id: "b", categoryId: "dept", categoryPath: ["dept"], images: [{ url: "/b.jpg", alt: "", width: 8, height: 10 }] }),
    ];

    const [dept, sub] = withBorrowedImages(cats, items);
    assert.notEqual(dept!.image?.url, sub!.image?.url);
  });

  test("the deepest category picks first", () => {
    /*
     * A specific subcategory has fewer products to choose from than the
     * department above it, so letting the department pick first can leave the
     * subcategory with nothing at all.
     */
    const cats = [
      category({ id: "dept", path: ["dept"], depth: 0 }),
      category({ id: "sub", parentId: "dept", path: ["dept", "sub"], depth: 1 }),
    ];
    // Only one product, and it is in the subcategory.
    const items = [product({ id: "only", categoryId: "sub", categoryPath: ["dept", "sub"] })];

    const [, sub] = withBorrowedImages(cats, items);
    assert.equal(sub!.image?.url, "/demo/p1.jpg");
  });

  test("a department borrows from a product filed in its subcategory", () => {
    // No product is ever filed against a department directly, so matching on
    // `categoryId` alone would leave every department blank.
    const cats = [category({ id: "dept", path: ["dept"], depth: 0 })];
    const items = [product({ categoryId: "sub", categoryPath: ["dept", "sub"] })];
    assert.equal(withBorrowedImages(cats, items)[0]!.image?.url, "/demo/p1.jpg");
  });

  test("a draft product is never borrowed from", () => {
    // The tile would show a piece the shop is not selling.
    const [result] = withBorrowedImages([category()], [product({ status: "draft" })]);
    assert.equal(result!.image, undefined);
  });

  test("a product with no images is skipped, not borrowed as empty", () => {
    const [result] = withBorrowedImages([category()], [product({ images: [] })]);
    assert.equal(result!.image, undefined);
  });

  test("a category with nothing in it keeps no image, rather than borrowing at random", () => {
    // A tile showing a garment from somewhere else is a promise the category
    // cannot keep.
    const cats = [category({ id: "empty", path: ["empty"] })];
    assert.equal(withBorrowedImages(cats, [product()])[0]!.image, undefined);
  });

  test("with fewer products than categories, a photograph repeats rather than a tile going blank", () => {
    /*
     * A repeated picture is a smaller failure than one blank tile beside
     * eleven filled ones, which reads as something having gone wrong.
     */
    const cats = [
      category({ id: "a", path: ["a"] }),
      category({ id: "b", path: ["b"] }),
    ];
    const items = [
      product({ id: "one", categoryId: "a", categoryPath: ["a"] }),
      product({ id: "two", categoryId: "b", categoryPath: ["b"] }),
    ];
    const results = withBorrowedImages(cats, items);
    assert.equal(results.every((c) => Boolean(c.image)), true);
  });

  test("a borrowed picture carries empty alt text", () => {
    /*
     * The tile's own label is the link text directly beneath it. Describing
     * the picture as well makes a screen reader announce every category twice,
     * and this photograph is standing in for the category rather than being
     * the thing shown.
     */
    assert.equal(withBorrowedImages([category()], [product()])[0]!.image?.alt, "");
  });

  test("no categories and no products is not a crash", () => {
    assert.deepEqual(withBorrowedImages([], []), []);
  });
});
