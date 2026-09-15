import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadBytes, deleteObject } from "firebase/storage";

/**
 * Storage rules, executed.
 *
 * The companion to `rules.test.ts`, and the half that covers the item the
 * brief named directly: "منع المستخدم من ... مشاهدة صور خاصة بغيره" — stopping
 * one customer seeing another's private images. That is a Storage rule, not a
 * Firestore one, and it had never been tested.
 *
 * Two properties matter most here and both are written from the attacker's
 * side:
 *
 *  1. A fitting-room photograph is readable by its owner and **nobody else**,
 *     staff included. It is the most sensitive file the shop holds.
 *  2. No path anywhere accepts an SVG. An SVG is an executable document: it
 *     can carry a script, and served from our own origin that is a stored XSS.
 *
 * Run with:  npm run test:storage-rules
 */

const PROJECT_ID = "netsale-storage-rules-test";

let env: RulesTestEnvironment;

const asUser = (uid: string) => env.authenticatedContext(uid).storage();
const asStaff = () => env.authenticatedContext("staff-1", { role: "staff" }).storage();
const asGuest = () => env.unauthenticatedContext().storage();

/** A minimal, valid PNG header — enough for a content-type check. */
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const svg = () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

const asPng = { contentType: "image/png" };
const asSvg = { contentType: "image/svg+xml" };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: readFileSync("storage.rules", "utf8"),
      host: "127.0.0.1",
      port: 9199,
    },
  });
});

after(async () => {
  await env?.cleanup();
});

async function seed(path: string, metadata = asPng) {
  await env.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), path), png(), metadata);
  });
}

/* -------------------------------------------------------------------------- */

describe("fitting-room photographs", () => {
  test("only the owner may read one — staff included in the exclusion", async () => {
    /*
     * The most sensitive file the shop touches. Staff have no reason to see a
     * customer's body photograph, and an operations team that *can* is a
     * breach waiting for one bad hire.
     */
    await seed("users/owner/fitting/photo.png");

    await assertSucceeds(getBytes(ref(asUser("owner"), "users/owner/fitting/photo.png")));
    await assertFails(getBytes(ref(asUser("stranger"), "users/owner/fitting/photo.png")));
    await assertFails(getBytes(ref(asStaff(), "users/owner/fitting/photo.png")));
    await assertFails(getBytes(ref(asGuest(), "users/owner/fitting/photo.png")));
  });

  test("nobody may upload into another customer's folder", async () => {
    await assertSucceeds(
      uploadBytes(ref(asUser("owner"), "users/owner/fitting/new.png"), png(), asPng),
    );
    await assertFails(
      uploadBytes(ref(asUser("stranger"), "users/owner/fitting/evil.png"), png(), asPng),
    );
  });

  test("the owner can delete their own photograph", async () => {
    // "You can remove it at any time" is a promise the consent text makes.
    await seed("users/owner/fitting/delete-me.png");

    await assertFails(deleteObject(ref(asUser("stranger"), "users/owner/fitting/delete-me.png")));
    await assertSucceeds(deleteObject(ref(asUser("owner"), "users/owner/fitting/delete-me.png")));
  });
});

describe("avatars", () => {
  test("an avatar is the owner's and the shop's, not the world's", async () => {
    await seed("users/owner/avatar/me.png");

    await assertSucceeds(getBytes(ref(asUser("owner"), "users/owner/avatar/me.png")));
    await assertFails(getBytes(ref(asUser("stranger"), "users/owner/avatar/me.png")));
    // Staff do see avatars — they appear in the customer record.
    await assertSucceeds(getBytes(ref(asStaff(), "users/owner/avatar/me.png")));
  });
});

describe("review photographs", () => {
  test("published review images are public, and written only by their author", async () => {
    // A review photo is published next to the review by design.
    await seed("reviews/author/shot.png");

    await assertSucceeds(getBytes(ref(asGuest(), "reviews/author/shot.png")));
    await assertSucceeds(
      uploadBytes(ref(asUser("author"), "reviews/author/second.png"), png(), asPng),
    );
    await assertFails(
      uploadBytes(ref(asUser("stranger"), "reviews/author/forged.png"), png(), asPng),
    );
  });
});

describe("shop imagery", () => {
  test("product images are public to read and staff-only to write", async () => {
    await seed("products/p1/front.png");

    await assertSucceeds(getBytes(ref(asGuest(), "products/p1/front.png")));
    await assertFails(uploadBytes(ref(asUser("u1"), "products/p1/evil.png"), png(), asPng));
    await assertSucceeds(uploadBytes(ref(asStaff(), "products/p1/back.png"), png(), asPng));
  });

  test("a customer cannot write the shop's campaign artwork", async () => {
    // The reason review photos got their own folder rather than sharing this
    // one: letting every signed-in shopper write here is exactly this.
    await assertFails(uploadBytes(ref(asUser("u1"), "banners/hero.png"), png(), asPng));
    await assertSucceeds(uploadBytes(ref(asStaff(), "banners/hero.png"), png(), asPng));
  });
});

describe("SVG is never accepted", () => {
  test("no path takes an SVG, however it is dressed", async () => {
    /*
     * An SVG is an executable document. Served from our own origin a stored
     * XSS follows, and `next/image` runs with `dangerouslyAllowSVG` for the
     * bundled brand assets — so the bucket is the boundary that has to hold.
     */
    for (const path of [
      "products/p1/logo.svg",
      "banners/hero.svg",
      "categories/knitwear.svg",
      "reviews/author/shot.svg",
      "users/owner/avatar/me.svg",
      "users/owner/fitting/photo.svg",
    ]) {
      const uid = path.startsWith("users/owner") || path.startsWith("reviews/author")
        ? path.split("/")[1]!
        : "staff-1";
      const storage = uid === "staff-1" ? asStaff() : asUser(uid);
      await assertFails(uploadBytes(ref(storage, path), svg(), asSvg));
    }
  });

  test("a PNG with an SVG extension is still refused", async () => {
    // The check is on content type, not the name — but a mismatched pair
    // should not sneak through either way.
    await assertFails(uploadBytes(ref(asStaff(), "products/p1/x.svg"), png(), asSvg));
  });
});

describe("the default", () => {
  test("a path nobody wrote a rule for is closed", async () => {
    await seed("somewhere/else/file.png");

    await assertFails(getBytes(ref(asGuest(), "somewhere/else/file.png")));
    await assertFails(getBytes(ref(asStaff(), "somewhere/else/file.png")));
    await assertFails(uploadBytes(ref(asStaff(), "somewhere/else/new.png"), png(), asPng));
  });
});
