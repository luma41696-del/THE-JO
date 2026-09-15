import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  assetFrom,
  canDelete,
  humanBytes,
  matchesQuery,
  normalise,
  orphanedAfterSave,
  sameAsset,
  storagePathFromUrl,
  urlsUsedBy,
  usageAcross,
  usageOf,
  type MediaAsset,
} from "../src/lib/media";

/**
 * The media library, and the deletions it refuses.
 *
 * Nearly every test here is about *not* deleting something. That is the whole
 * value of the module: the old code deleted a file the moment a thumbnail's ×
 * was pressed, which broke published pages in two different ways, and neither
 * was visible until a customer hit one.
 *
 * Run with:
 *
 *     npm run test:media
 */

const BUCKET = "https://firebasestorage.googleapis.com/v0/b/the-jo-shop.appspot.com/o";
const url = (path: string, token = "abc") =>
  `${BUCKET}/${encodeURIComponent(path)}?alt=media&token=${token}`;

const LINEN = url("products/p1/linen-shirt-m1x.jpg");
const SWATCH = url("products/p1/swatch-m2y.jpg");
const DEMO = "/demo/cotton-tee.jpg";

function image(u: string, alt = "a") {
  return { url: u, alt, width: 1200, height: 1600 };
}

/* -------------------------------------------------------------------------- */
/*  Identity                                                                  */
/* -------------------------------------------------------------------------- */

describe("storagePathFromUrl", () => {
  test("recovers the object path from a download URL", () => {
    assert.equal(storagePathFromUrl(LINEN), "products/p1/linen-shirt-m1x.jpg");
  });

  test("a seeded asset has no path, because there is no object behind it", () => {
    // Deleting one would be a claim about a file that was never uploaded.
    assert.equal(storagePathFromUrl(DEMO), "");
    assert.equal(storagePathFromUrl("https://example.com/a.jpg"), "");
  });

  test("a malformed URL yields nothing rather than a guess", () => {
    assert.equal(storagePathFromUrl("https://firebasestorage.googleapis.com/v0/b/x/o/"), "");
  });
});

describe("sameAsset", () => {
  test("two URLs for one object are one file, whatever the token says", () => {
    /*
     * The failure this prevents: a re-issued download token makes the same
     * photograph look like two files, so the usage count reads zero and the
     * file a published product is displaying gets deleted.
     */
    const a = url("products/p1/linen-shirt-m1x.jpg", "token-one");
    const b = url("products/p1/linen-shirt-m1x.jpg", "token-two");
    assert.notEqual(a, b);
    assert.equal(sameAsset(a, b), true);
  });

  test("different objects are different files", () => {
    assert.equal(sameAsset(LINEN, SWATCH), false);
  });

  test("two identical seeded paths still match, by exact string", () => {
    assert.equal(sameAsset(DEMO, DEMO), true);
    assert.equal(sameAsset(DEMO, "/demo/other.jpg"), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Usage                                                                     */
/* -------------------------------------------------------------------------- */

describe("urlsUsedBy", () => {
  test("counts design thumbnails, not only the gallery", () => {
    // A design thumbnail is as much a published image as a gallery shot, and
    // leaving it out of the count is how one gets deleted from under a product.
    const product = {
      images: [image(LINEN)],
      designs: [
        {
          id: "palm",
          name: { en: "Palm", ar: "نخيل" },
          thumbnail: image(SWATCH),
          available: true,
          position: 0,
        },
      ],
    };
    assert.deepEqual(urlsUsedBy(product).sort(), [LINEN, SWATCH].sort());
  });

  test("the same file twice on one product is one URL", () => {
    assert.deepEqual(urlsUsedBy({ images: [image(LINEN), image(LINEN)] }), [LINEN]);
  });

  test("a product with nothing attached uses nothing", () => {
    assert.deepEqual(urlsUsedBy({}), []);
  });
});

describe("usageAcross", () => {
  const catalogue = [
    { id: "p1", images: [image(LINEN), image(SWATCH)] },
    { id: "p2", images: [image(SWATCH)] },
    { id: "p3", images: [image(DEMO)] },
  ];

  test("counts the products that point at each file", () => {
    const usage = usageAcross(catalogue);
    assert.equal(usageOf(usage, SWATCH)?.count, 2);
    assert.deepEqual(usageOf(usage, SWATCH)?.productIds, ["p1", "p2"]);
    assert.equal(usageOf(usage, LINEN)?.count, 1);
  });

  test("the product being saved is excluded, so its own removal is not self-blocking", () => {
    /*
     * Without this, removing an image from p1 would consult the *stored* p1,
     * see the image it is about to drop, and refuse forever.
     */
    const usage = usageAcross(catalogue, "p1");
    assert.equal(usageOf(usage, LINEN), undefined);
    assert.equal(usageOf(usage, SWATCH)?.count, 1);
  });

  test("a token difference does not split one file into two counts", () => {
    const usage = usageAcross([
      { id: "p1", images: [image(url("products/p1/linen-shirt-m1x.jpg", "t1"))] },
      { id: "p2", images: [image(url("products/p1/linen-shirt-m1x.jpg", "t2"))] },
    ]);
    assert.equal(usageOf(usage, LINEN)?.count, 2);
  });
});

/* -------------------------------------------------------------------------- */
/*  Refusing to delete                                                        */
/* -------------------------------------------------------------------------- */

describe("canDelete", () => {
  test("an unused uploaded file may go", () => {
    assert.equal(canDelete(LINEN, usageAcross([])).ok, true);
  });

  test("a file another product still shows is refused, and says who has it", () => {
    const usage = usageAcross([{ id: "p2", images: [image(SWATCH)] }]);
    const verdict = canDelete(SWATCH, usage);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "in-use");
    assert.deepEqual(verdict.usedBy, ["p2"]);
    assert.equal(verdict.message.ar.length > 0, true);
  });

  test("the refusal counts, so the merchant knows how much work removing it is", () => {
    const usage = usageAcross([
      { id: "p1", images: [image(SWATCH)] },
      { id: "p2", images: [image(SWATCH)] },
    ]);
    assert.equal(canDelete(SWATCH, usage).message.en.includes("2"), true);
  });

  test("a seeded asset is refused as having no file, not as being in use", () => {
    // Different reason, different fix — telling a merchant to "remove it from
    // the products first" when there is no object to delete sends them on a
    // pointless errand.
    const verdict = canDelete(DEMO, usageAcross([]));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "not-a-managed-file");
  });
});

/* -------------------------------------------------------------------------- */
/*  What is orphaned once the save lands                                      */
/* -------------------------------------------------------------------------- */

describe("orphanedAfterSave", () => {
  test("a file dropped from the only product that had it is orphaned", () => {
    assert.deepEqual(orphanedAfterSave([LINEN], [], usageAcross([])), [LINEN]);
  });

  test("a file removed and then put back is kept", () => {
    /*
     * The merchant reordered, changed their mind, and saved. Deleting here
     * would delete a file the document they just wrote points at.
     */
    assert.deepEqual(orphanedAfterSave([LINEN], [LINEN], usageAcross([])), []);
  });

  test("put back under a re-issued token, it is still kept", () => {
    const again = url("products/p1/linen-shirt-m1x.jpg", "fresh-token");
    assert.deepEqual(orphanedAfterSave([LINEN], [again], usageAcross([])), []);
  });

  test("a file another product still shows is never deleted", () => {
    const usage = usageAcross([{ id: "p2", images: [image(SWATCH)] }]);
    assert.deepEqual(orphanedAfterSave([SWATCH], [], usage), []);
  });

  test("a seeded asset is never deleted", () => {
    assert.deepEqual(orphanedAfterSave([DEMO], [], usageAcross([])), []);
  });

  test("mixed removals sort themselves out", () => {
    const usage = usageAcross([{ id: "p2", images: [image(SWATCH)] }]);
    assert.deepEqual(orphanedAfterSave([LINEN, SWATCH, DEMO], [], usage), [LINEN]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Finding a file again                                                      */
/* -------------------------------------------------------------------------- */

const asset: MediaAsset = {
  url: LINEN,
  path: "products/p1/linen-shirt-m1x.jpg",
  alt: "قميص كتان أبيض",
  width: 1200,
  height: 1600,
  filename: "linen-shirt-front.jpg",
  uploadedAt: 0,
  tags: ["summer"],
};

describe("matchesQuery", () => {
  test("finds a file by part of its name", () => {
    assert.equal(matchesQuery(asset, "linen"), true);
    assert.equal(matchesQuery(asset, "front"), true);
    assert.equal(matchesQuery(asset, "denim"), false);
  });

  test("every word must match, so two words narrow rather than widen", () => {
    assert.equal(matchesQuery(asset, "linen front"), true);
    assert.equal(matchesQuery(asset, "linen denim"), false);
  });

  test("finds it by its Arabic alt text, however the alef was typed", () => {
    /*
     * A merchant searching "ابيض" for a file they described as "أبيض" is
     * searching for the same word. Requiring the hamza would make the library
     * unsearchable in the language half the shop is written in.
     */
    assert.equal(matchesQuery(asset, "أبيض"), true);
    assert.equal(matchesQuery(asset, "ابيض"), true);
    assert.equal(matchesQuery(asset, "كتان"), true);
  });

  test("finds it by a tag", () => {
    assert.equal(matchesQuery(asset, "summer"), true);
  });

  test("an empty query matches everything, rather than nothing", () => {
    assert.equal(matchesQuery(asset, ""), true);
    assert.equal(matchesQuery(asset, "   "), true);
  });
});

describe("normalise", () => {
  test("strips harakat", () => {
    assert.equal(normalise("قَمِيص"), normalise("قميص"));
  });

  test("folds ta marbuta and alef maqsura", () => {
    assert.equal(normalise("قبعة"), normalise("قبعه"));
    assert.equal(normalise("مرمى"), normalise("مرمي"));
  });
});

describe("humanBytes", () => {
  test("reads as a size, not as a number", () => {
    assert.equal(humanBytes(900), "900 B");
    assert.equal(humanBytes(2048), "2 KB");
    assert.equal(humanBytes(2411923), "2.3 MB");
  });

  test("an unknown size says nothing rather than zero", () => {
    assert.equal(humanBytes(undefined), "");
    assert.equal(humanBytes(0), "");
  });
});

describe("assetFrom", () => {
  test("carries the path, so the record is deletable later", () => {
    const record = assetFrom(image(LINEN, "white linen"), {
      name: "Linen-Shirt-FRONT.jpg",
      size: 2048,
      type: "image/jpeg",
    });
    assert.equal(record.path, "products/p1/linen-shirt-m1x.jpg");
    assert.equal(record.filename, "linen-shirt-front.jpg");
    assert.equal(record.alt, "white linen");
    assert.equal(record.width, 1200);
  });
});
