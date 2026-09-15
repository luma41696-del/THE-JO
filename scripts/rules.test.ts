import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection } from "firebase/firestore";

/**
 * Security rules, executed.
 *
 * `firestore.rules` has carried the line "Test with: firebase emulators:exec
 * --only firestore 'npm run test:rules'" since it was written. That script did
 * not exist. So the rules protecting orders, invoices, body measurements and
 * fitting-room photographs had been verified by reading them — which catches
 * the mistakes you thought of and none of the ones you did not.
 *
 * Run with:
 *
 *     npm run test:rules
 *
 * which starts the Firestore emulator, runs this, and shuts it down. Nothing
 * here touches the real project: the emulator is a separate process with its
 * own empty database.
 *
 * Every test below is written from the attacker's side where it can be —
 * "can a signed-in stranger read this" rather than "can the owner". The
 * owner's path failing is a bug that gets reported in minutes; the stranger's
 * path succeeding is a breach nobody notices.
 */

const PROJECT_ID = "netsale-rules-test";

let env: RulesTestEnvironment;

/** A signed-in customer. */
const asUser = (uid: string) => env.authenticatedContext(uid).firestore();
/** A signed-in member of staff, via the custom claim the rules read. */
const asStaff = () => env.authenticatedContext("staff-1", { role: "staff" }).firestore();
const asAdmin = () => env.authenticatedContext("admin-1", { role: "admin" }).firestore();
const asGuest = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await env?.cleanup();
});

/**
 * Seed with rules disabled.
 *
 * `withSecurityRulesDisabled` is the only way to create the documents a read
 * test needs — writing them through the rules would be testing the write path
 * to set up the read path, and a failure would then be ambiguous.
 */
async function seed(write: (db: ReturnType<typeof asGuest>) => Promise<unknown>) {
  await env.withSecurityRulesDisabled(async (context) => {
    await write(context.firestore() as never);
  });
}

/* -------------------------------------------------------------------------- */

describe("catalogue", () => {
  test("anyone reads an active product; nobody writes one", async () => {
    await seed((db) => setDoc(doc(db, "products/p1"), { status: "active", title: "Coat" }));

    await assertSucceeds(getDoc(doc(asGuest(), "products/p1")));
    await assertFails(setDoc(doc(asGuest(), "products/p2"), { status: "active" }));
    await assertFails(setDoc(doc(asUser("u1"), "products/p2"), { status: "active" }));
    await assertSucceeds(setDoc(doc(asStaff(), "products/p2"), { status: "active" }));
  });

  test("a draft product is invisible to shoppers", async () => {
    // Drafts are unfinished work, sometimes with placeholder pricing.
    await seed((db) => setDoc(doc(db, "products/draft"), { status: "draft" }));

    await assertFails(getDoc(doc(asGuest(), "products/draft")));
    await assertFails(getDoc(doc(asUser("u1"), "products/draft")));
    await assertSucceeds(getDoc(doc(asStaff(), "products/draft")));
  });
});

describe("offers", () => {
  test("a gift code assigned to someone is not readable by everyone", async () => {
    /*
     * The harvest hole this rule closed: without the `assignedUid` clause a
     * signed-in stranger could list `offers` and collect every gift code the
     * shop had issued.
     */
    await seed((db) =>
      setDoc(doc(db, "offers/gift1"), { active: true, code: "GIFT", assignedUid: "owner" }),
    );

    await assertFails(getDoc(doc(asUser("stranger"), "offers/gift1")));
    await assertSucceeds(getDoc(doc(asUser("owner"), "offers/gift1")));
    await assertSucceeds(getDoc(doc(asStaff(), "offers/gift1")));
  });

  test("a public coupon stays public, and a paused one does not", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "offers/public"), { active: true, code: "SUMMER" });
      await setDoc(doc(db, "offers/paused"), { active: false, code: "OLD" });
    });

    await assertSucceeds(getDoc(doc(asGuest(), "offers/public")));
    await assertFails(getDoc(doc(asGuest(), "offers/paused")));
  });

  test("nobody can hand themselves back a spent redemption", async () => {
    await seed((db) => setDoc(doc(db, "offers/o1"), { active: true, usageCount: 5 }));

    // `usageCount` is what enforces a redemption limit.
    await assertFails(updateDoc(doc(asStaff(), "offers/o1"), { usageCount: 0 }));
    await assertSucceeds(updateDoc(doc(asStaff(), "offers/o1"), { code: "RENAMED" }));
  });

  test("redemptions are readable by their owner and writable by nobody", async () => {
    await seed((db) => setDoc(doc(db, "offerRedemptions/r1"), { uid: "owner" }));

    await assertSucceeds(getDoc(doc(asUser("owner"), "offerRedemptions/r1")));
    await assertFails(getDoc(doc(asUser("stranger"), "offerRedemptions/r1")));
    await assertFails(setDoc(doc(asUser("owner"), "offerRedemptions/r2"), { uid: "owner" }));
  });
});

describe("orders", () => {
  test("a customer reads their own order and not anybody else's", async () => {
    await seed((db) => setDoc(doc(db, "orders/o1"), { uid: "owner", reference: "NS-1" }));

    await assertSucceeds(getDoc(doc(asUser("owner"), "orders/o1")));
    await assertFails(getDoc(doc(asUser("stranger"), "orders/o1")));
    await assertFails(getDoc(doc(asGuest(), "orders/o1")));
    await assertSucceeds(getDoc(doc(asStaff(), "orders/o1")));
  });

  test("no client may create an order", async () => {
    // The only way to guarantee the price charged is the price we set.
    await assertFails(setDoc(doc(asUser("u1"), "orders/new"), { uid: "u1", total: 1 }));
    await assertFails(setDoc(doc(asStaff(), "orders/new"), { uid: "u1", total: 1 }));
    await assertFails(setDoc(doc(asAdmin(), "orders/new"), { uid: "u1", total: 1 }));
  });

  test("a customer cannot advance their own order to paid", async () => {
    await seed((db) => setDoc(doc(db, "orders/o2"), { uid: "owner", status: "pending" }));

    await assertFails(updateDoc(doc(asUser("owner"), "orders/o2"), { status: "paid" }));
    await assertSucceeds(updateDoc(doc(asStaff(), "orders/o2"), { status: "paid" }));
  });

  test("checkout idempotency claims are invisible and unforgeable", async () => {
    // These are what stop a retried checkout becoming a second order.
    await seed((db) => setDoc(doc(db, "checkoutClaims/k1"), { orderId: "o1" }));

    await assertFails(getDoc(doc(asUser("u1"), "checkoutClaims/k1")));
    await assertFails(getDoc(doc(asStaff(), "checkoutClaims/k1")));
    await assertFails(setDoc(doc(asUser("u1"), "checkoutClaims/k2"), { orderId: "x" }));
  });
});

describe("invoices and counters", () => {
  test("a customer reads the invoice for their own order only", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "orders/o1"), { uid: "owner" });
      await setDoc(doc(db, "invoices/i1"), { orderId: "o1", number: "INV-2026-00001" });
    });

    await assertSucceeds(getDoc(doc(asUser("owner"), "invoices/i1")));
    await assertFails(getDoc(doc(asUser("stranger"), "invoices/i1")));
    await assertSucceeds(getDoc(doc(asStaff(), "invoices/i1")));
  });

  test("nobody writes an invoice from a client — staff included", async () => {
    /*
     * A client that could create one could burn a number out of the gapless
     * sequence; one that could edit one could rewrite what a customer was
     * charged after the fact.
     */
    await assertFails(setDoc(doc(asUser("u1"), "invoices/new"), { orderId: "o1" }));
    await assertFails(setDoc(doc(asStaff(), "invoices/new"), { orderId: "o1" }));
    await assertFails(setDoc(doc(asAdmin(), "invoices/new"), { orderId: "o1" }));
  });

  test("the invoice counter is completely closed", async () => {
    await seed((db) => setDoc(doc(db, "counters/invoices-2026"), { next: 42 }));

    // Reading it leaks the shop's order volume; writing it resets the year.
    await assertFails(getDoc(doc(asAdmin(), "counters/invoices-2026")));
    await assertFails(updateDoc(doc(asAdmin(), "counters/invoices-2026"), { next: 0 }));
  });
});

describe("reviews", () => {
  test("a customer cannot edit somebody else's review", async () => {
    // Named explicitly in the brief's test list.
    await seed((db) =>
      setDoc(doc(db, "reviews/r1"), { uid: "author", status: "published", rating: 5 }),
    );

    await assertFails(updateDoc(doc(asUser("stranger"), "reviews/r1"), { rating: 1 }));
    // Nor their own: edits go through /api/reviews, which re-moderates.
    await assertFails(updateDoc(doc(asUser("author"), "reviews/r1"), { rating: 1 }));
  });

  test("a held review is visible to its author and staff, not to the world", async () => {
    await seed((db) =>
      setDoc(doc(db, "reviews/pending"), { uid: "author", status: "pending", body: "…" }),
    );

    // Publishing pending reviews publishes what moderation exists to catch.
    await assertFails(getDoc(doc(asGuest(), "reviews/pending")));
    await assertFails(getDoc(doc(asUser("stranger"), "reviews/pending")));
    await assertSucceeds(getDoc(doc(asUser("author"), "reviews/pending")));
    await assertSucceeds(getDoc(doc(asStaff(), "reviews/pending")));
  });
});

describe("customer data", () => {
  test("a stranger cannot read another customer's profile or measurements", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/owner"), {
        email: "owner@example.com",
        fitProfile: { heightCm: 172, chestCm: 96 },
      }),
    );

    await assertFails(getDoc(doc(asUser("stranger"), "users/owner")));
    await assertSucceeds(getDoc(doc(asUser("owner"), "users/owner")));
  });

  test("a customer cannot give themselves a role", async () => {
    // The whole reason `role` is a signed custom claim and not a field.
    await seed((db) => setDoc(doc(db, "users/owner"), { email: "o@example.com" }));

    await assertFails(updateDoc(doc(asUser("owner"), "users/owner"), { role: "admin" }));
    await assertSucceeds(updateDoc(doc(asUser("owner"), "users/owner"), { phone: "0790000000" }));
  });

  test("saved fitting-room looks are private to their owner", async () => {
    await seed((db) => setDoc(doc(db, "users/owner/outfits/look1"), { uid: "owner", items: {} }));

    await assertSucceeds(getDoc(doc(asUser("owner"), "users/owner/outfits/look1")));
    await assertFails(getDoc(doc(asUser("stranger"), "users/owner/outfits/look1")));
    // Staff too: measurements and looks are not operational data.
    await assertFails(getDoc(doc(asStaff(), "users/owner/outfits/look1")));
  });

  test("a customer's cart is their own", async () => {
    await seed((db) => setDoc(doc(db, "carts/owner"), { items: [] }));

    await assertSucceeds(getDoc(doc(asUser("owner"), "carts/owner")));
    await assertFails(getDoc(doc(asUser("stranger"), "carts/owner")));
  });

  test("a support ticket is readable by its author and staff only", async () => {
    await seed((db) => setDoc(doc(db, "tickets/t1"), { uid: "owner", subject: "Where is it?" }));

    await assertSucceeds(getDoc(doc(asUser("owner"), "tickets/t1")));
    await assertFails(getDoc(doc(asUser("stranger"), "tickets/t1")));
    // A customer cannot edit what support said, or close their own ticket.
    await assertFails(updateDoc(doc(asUser("owner"), "tickets/t1"), { status: "resolved" }));
  });

  test("nobody opens a ticket from a browser", async () => {
    /*
     * Both sides of a support conversation are written by the Admin SDK now —
     * /api/support for the customer, /api/admin/support for staff. A client
     * that could create its own ticket could file one with no reference, no
     * status and no priority, or seed the thread with a message marked
     * `fromStaff` and forge an answer from the shop.
     */
    await assertFails(
      setDoc(doc(asUser("owner"), "tickets/forged"), { uid: "owner", subject: "Mine" }),
    );
    await assertFails(
      setDoc(doc(asUser("owner"), "tickets/forged2"), {
        uid: "owner",
        messages: [{ body: "Refunded, no need to pay", fromStaff: true }],
      }),
    );
  });
});

describe("gift game", () => {
  test("a play is readable by its owner and writable by nobody", async () => {
    await seed((db) => setDoc(doc(db, "giftPlays/p1"), { uid: "owner", prizeId: "x" }));

    await assertSucceeds(getDoc(doc(asUser("owner"), "giftPlays/p1")));
    await assertFails(getDoc(doc(asUser("stranger"), "giftPlays/p1")));
    // The server decides the prize. A writable play is a self-served prize.
    await assertFails(setDoc(doc(asUser("owner"), "giftPlays/p2"), { uid: "owner" }));
  });
});

describe("analytics", () => {
  test("behavioural events are write-only from the client's point of view", async () => {
    await seed((db) => setDoc(doc(db, "analyticsEvents/e1"), { name: "page_view" }));

    // Readable would make the collection a session log of every shopper.
    await assertFails(getDoc(doc(asUser("u1"), "analyticsEvents/e1")));
    await assertFails(setDoc(doc(asUser("u1"), "analyticsEvents/e2"), { name: "x" }));
  });
});

describe("settings, shipping and notifications", () => {
  test("store settings are world-readable and admin-written", async () => {
    // The footer needs them for signed-out visitors.
    await seed((db) => setDoc(doc(db, "settings/store"), { freeShippingThreshold: 75 }));

    await assertSucceeds(getDoc(doc(asGuest(), "settings/store")));
    await assertFails(updateDoc(doc(asUser("u1"), "settings/store"), { freeShippingThreshold: 0 }));
    // Staff may edit a product; the return window is a policy decision.
    await assertFails(updateDoc(doc(asStaff(), "settings/store"), { freeShippingThreshold: 0 }));
    await assertSucceeds(updateDoc(doc(asAdmin(), "settings/store"), { freeShippingThreshold: 80 }));
  });

  test("delivery zones are readable by the checkout and written only by an admin", async () => {
    /*
     * Readable matters as much as writable here: the checkout resolves the
     * zone in the browser to quote a price. A denied read fails silently and
     * every address quotes the un-zoned price — a shop undercharging for the
     * far governorates and never finding out.
     */
    await seed((db) => setDoc(doc(db, "shippingZones/amman"), { surcharge: 0 }));

    await assertSucceeds(getDoc(doc(asGuest(), "shippingZones/amman")));
    await assertFails(updateDoc(doc(asUser("u1"), "shippingZones/amman"), { surcharge: 99 }));
    await assertSucceeds(updateDoc(doc(asAdmin(), "shippingZones/amman"), { surcharge: 3 }));
  });

  test("the notification log is staff-only and client-write-never", async () => {
    await seed((db) =>
      setDoc(doc(db, "notifications/n1"), { orderId: "o1", to: "lina@example.com" }),
    );

    // A readable log of who was emailed is a directory of the shop's customers.
    await assertFails(getDoc(doc(asUser("u1"), "notifications/n1")));
    await assertSucceeds(getDoc(doc(asStaff(), "notifications/n1")));
    // A client that could write here could mark a message sent that never was.
    await assertFails(setDoc(doc(asStaff(), "notifications/n2"), { orderId: "o1" }));
  });
});

describe("the default", () => {
  test("a collection nobody wrote a rule for is closed", async () => {
    /*
     * The property every other rule rests on. If this ever passes, the
     * catch-all at the bottom of the file has been replaced with something
     * permissive "for now".
     */
    await seed((db) => setDoc(doc(db, "somethingNew/x"), { secret: true }));

    await assertFails(getDoc(doc(asGuest(), "somethingNew/x")));
    await assertFails(getDoc(doc(asUser("u1"), "somethingNew/x")));
    await assertFails(getDoc(doc(asAdmin(), "somethingNew/x")));
    await assertFails(setDoc(doc(asAdmin(), "somethingNew/y"), { secret: true }));
  });

  test("the audit log cannot be edited by the people it records", async () => {
    await seed((db) => setDoc(doc(db, "auditLog/a1"), { action: "order.status", actorUid: "staff-1" }));

    await assertSucceeds(getDoc(doc(asAdmin(), "auditLog/a1")));
    await assertFails(getDoc(doc(asStaff(), "auditLog/a1")));
    await assertFails(deleteDoc(doc(asAdmin(), "auditLog/a1")));
    await assertFails(setDoc(doc(asAdmin(), "auditLog/a2"), { action: "forged" }));
  });

  test("listing a collection obeys the same rules as reading a document", async () => {
    // A query is not a back door: `getDocs` on orders must fail for a stranger
    // even though each document's own rule would.
    await seed((db) => setDoc(doc(db, "orders/o9"), { uid: "someone-else" }));

    await assertFails(getDocs(collection(asUser("stranger"), "orders")));
    await assertSucceeds(getDocs(collection(asStaff(), "orders")));
  });
});
