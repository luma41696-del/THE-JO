import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  availableSizeIds,
  availableValueIds,
  buildCartItem,
  lineOptions,
  requiredAxes,
  resolveSelection,
  stockFor,
  variantFor,
} from "../src/lib/product";
import { cartKey } from "../src/lib/utils";
import type { Product, ProductAttribute, ProductVariant } from "../src/types";

/**
 * Selling a product that varies by something other than colour and size.
 *
 * The admin can now define a Capacity axis; this is the half that decides
 * whether the shop can actually sell one. Run with:
 *
 *     npm run test:storefront-attributes
 */

const capacity: ProductAttribute = {
  id: "capacity",
  name: { en: "Capacity", ar: "السعة" },
  kind: "custom",
  values: [
    { id: "15", label: { en: "1.5 L", ar: "١٫٥ ل" } },
    { id: "17", label: { en: "1.7 L", ar: "١٫٧ ل" } },
  ],
};

function kettle(variants: ProductVariant[], attributes = [capacity]): Product {
  return {
    id: "kettle",
    slug: "kettle",
    type: "variable",
    title: { en: "Kettle", ar: "غلاية" },
    description: { en: "", ar: "" },
    price: 30,
    currency: "JOD",
    categoryId: "objects",
    categoryPath: ["objects"],
    images: [{ url: "/demo/kettle.svg", alt: "Kettle", width: 400, height: 520 }],
    colors: [{ id: "steel", name: { en: "Steel", ar: "فولاذ" }, hex: "#c0c0c0" }],
    sizes: [{ id: "one", label: "One size", system: "one-size" }],
    sizeSystem: "one-size",
    attributes,
    variants,
    badges: [],
    status: "active",
    totalStock: variants.reduce((sum, v) => sum + v.stock, 0),
    tags: [],
    sku: "KET",
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Product;
}

const rows: ProductVariant[] = [
  { sku: "KET-15", colorId: "steel", sizeId: "one", stock: 4, attributes: { capacity: "15" } },
  {
    sku: "KET-17",
    colorId: "steel",
    sizeId: "one",
    stock: 0,
    priceOverride: 34,
    attributes: { capacity: "17" },
  },
];

describe("resolving a variant by attribute", () => {
  test("the chosen capacity picks its own row, not the first one", () => {
    const product = kettle(rows);
    assert.equal(variantFor(product, "steel", "one", "", { capacity: "15" })?.sku, "KET-15");
    assert.equal(variantFor(product, "steel", "one", "", { capacity: "17" })?.sku, "KET-17");
  });

  test("stock follows the capacity, so a sold-out one does not borrow the other's", () => {
    const product = kettle(rows);
    assert.equal(stockFor(product, "steel", "one", "", { capacity: "15" }), 4);
    assert.equal(stockFor(product, "steel", "one", "", { capacity: "17" }), 0);
  });

  test("so does the price — the dearer capacity says so before the bag", () => {
    const product = kettle(rows);
    assert.equal(resolveSelection(product, "steel", "one", "", { capacity: "15" }).price, 30);
    assert.equal(resolveSelection(product, "steel", "one", "", { capacity: "17" }).price, 34);
  });

  /*
   * The whole reason `buyable` grew a clause. Without it the page would add
   * whichever row sorts first the moment it loaded, and the customer would
   * find out which capacity they bought at the door.
   */
  test("nothing is buyable until every declared axis is answered", () => {
    const product = kettle(rows);
    assert.equal(resolveSelection(product, "steel", "one").buyable, false);
    assert.equal(resolveSelection(product, "steel", "one", "", { capacity: "15" }).buyable, true);
  });

  test("a sold-out capacity resolves but does not sell", () => {
    const selection = resolveSelection(kettle(rows), "steel", "one", "", { capacity: "17" });
    assert.equal(selection.buyable, false);
    assert.equal(selection.variant?.sku, "KET-17");
  });

  test("a product with no axes of its own is unaffected", () => {
    const plain = kettle(
      [{ sku: "KET", colorId: "steel", sizeId: "one", stock: 2 }],
      [],
    );
    assert.deepEqual(requiredAxes(plain), []);
    assert.equal(resolveSelection(plain, "steel", "one").buyable, true);
  });

  /*
   * Rows written before the merchant added the axis have nothing stored for
   * it. Refusing to match those would make the whole product unbuyable the
   * instant a Capacity column appeared in the admin.
   */
  test("a row that predates the axis still answers for it", () => {
    const migrating = kettle([{ sku: "KET-OLD", colorId: "steel", sizeId: "one", stock: 3 }]);
    assert.equal(variantFor(migrating, "steel", "one", "", { capacity: "15" })?.sku, "KET-OLD");
    assert.equal(stockFor(migrating, "steel", "one", "", { capacity: "17" }), 3);
  });
});

describe("greying out what cannot be bought", () => {
  test("a capacity with no stock is reported unavailable", () => {
    assert.deepEqual(availableValueIds(kettle(rows), "capacity", "steel"), ["15"]);
  });

  test("the axis being asked about does not filter itself out", () => {
    // With 1.7 L selected, 1.5 L must still report as available — otherwise
    // every value but the current one greys out and the picker is a dead end.
    const ids = availableValueIds(kettle(rows), "capacity", "steel", "", { capacity: "17" });
    assert.deepEqual(ids, ["15"]);
  });

  test("a disabled row is unavailable whatever its count says", () => {
    const withDisabled = kettle([
      { ...rows[0]!, available: false },
      { ...rows[1]!, stock: 5 },
    ]);
    assert.deepEqual(availableValueIds(withDisabled, "capacity", "steel"), ["17"]);
  });

  test("sizes grey out per capacity", () => {
    const tee = kettle([
      { sku: "A", colorId: "steel", sizeId: "one", stock: 0, attributes: { capacity: "15" } },
      { sku: "B", colorId: "steel", sizeId: "one", stock: 6, attributes: { capacity: "17" } },
    ]);
    assert.deepEqual(availableSizeIds(tee, "steel", "", { capacity: "15" }), []);
    assert.deepEqual(availableSizeIds(tee, "steel", "", { capacity: "17" }), ["one"]);
  });

  test("a row with nothing stored for the axis greys nothing out", () => {
    const migrating = kettle([{ sku: "KET-OLD", colorId: "steel", sizeId: "one", stock: 3 }]);
    assert.deepEqual(availableValueIds(migrating, "capacity", "steel"), ["15", "17"]);
  });
});

describe("the bag line", () => {
  /*
   * Two capacities of one colour and size are two things. Sharing a key means
   * the second add bumps the first line's quantity, and the customer is
   * charged twice for a capacity they did not choose.
   */
  test("two capacities are two lines, not one", () => {
    assert.notEqual(
      cartKey("kettle", "steel", "one", "", { capacity: "15" }),
      cartKey("kettle", "steel", "one", "", { capacity: "17" }),
    );
  });

  test("the key does not depend on which picker was touched first", () => {
    assert.equal(
      cartKey("p", "c", "s", "", { capacity: "15", width: "60" }),
      cartKey("p", "c", "s", "", { width: "60", capacity: "15" }),
    );
  });

  /*
   * Every key already sitting in somebody's persisted bag has to keep its
   * exact spelling, or the stepper and the remove button stop working on it.
   */
  test("a line with no attributes is keyed exactly as it always was", () => {
    assert.equal(cartKey("p", "c", "s"), "p:c:s");
    assert.equal(cartKey("p", "c", "s", "d"), "p:c:s:d");
    assert.equal(cartKey("p", "c", "s", "", {}), "p:c:s");
  });

  test("the chosen values are copied onto the line, labels and all", () => {
    const product = kettle(rows);
    const selection = resolveSelection(product, "steel", "one", "", { capacity: "15" });
    const line = buildCartItem(product, selection, "steel", "one", 1, "", { capacity: "15" });

    assert.deepEqual(line.attributes, [
      {
        id: "capacity",
        name: { en: "Capacity", ar: "السعة" },
        valueId: "15",
        valueLabel: { en: "1.5 L", ar: "١٫٥ ل" },
      },
    ]);
  });

  test("the axis reaches the words the customer and the packer both read", () => {
    const product = kettle(rows);
    const selection = resolveSelection(product, "steel", "one", "", { capacity: "15" });
    const line = buildCartItem(product, selection, "steel", "one", 1, "", { capacity: "15" });

    assert.deepEqual(lineOptions(line, "en"), ["Steel", "One size", "1.5 L"]);
    assert.equal(lineOptions(line, "ar").at(-1), "١٫٥ ل");
  });

  test("a simple line still describes itself with no stray separators", () => {
    const line = {
      colorName: { en: "", ar: "" },
      sizeLabel: "",
      title: { en: "Comb", ar: "مشط" },
    } as never;
    assert.deepEqual(lineOptions(line, "en"), []);
  });
});
