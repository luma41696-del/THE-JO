import { strict as assert } from "node:assert";
import { generateKeyPairSync } from "node:crypto";
import { after, before, describe, test } from "node:test";

/**
 * The support chat, the access screen and the gift invitation — end to end,
 * through the real route handlers, against emulators.
 *
 * The unit tests cover what can be decided without a database. This covers the
 * half that cannot: that a customer's message is actually stored, that staff's
 * reply lands in the *same* thread, that a stranger cannot read or write it,
 * and that the access route refuses the three ways an admin screen gets
 * misused. Those are all properties of the route, not of a pure function, and
 * reading the code is not evidence that they hold.
 *
 * Run with:
 *
 *     npm run test:e2e
 *
 * which starts the Auth and Firestore emulators, runs this, and shuts them
 * down. Nothing here touches the real project: the emulators are separate
 * processes with their own empty databases, and the env below points every
 * Firebase call at them before a single module is imported.
 */

/* -------------------------------------------------------------------------- */
/*  A clean room                                                              */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = "netsale-e2e-test";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT_ID;
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = `e2e@${PROJECT_ID}.iam.gserviceaccount.com`;

/*
 * The client config, which some route modules pull in transitively — the
 * product save route reads the category tree through `lib/catalog`, and that
 * imports the browser SDK's config. These are public identifiers, not
 * credentials, and nothing in this run reaches Google: the Firestore and Auth
 * emulator hosts above intercept every call. They exist only so the module's
 * own "did you copy .env.example" guard does not throw at import time.
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= "emulator";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??= `${PROJECT_ID}.firebaseapp.com`;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??= `${PROJECT_ID}.appspot.com`;
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??= "0";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??= "1:0:web:emulator";
process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS ??= "true";

/*
 * A throwaway key, generated here rather than checked in.
 *
 * `getAdminApp` builds its credential with `cert()`, which parses the PEM — so
 * the string has to be a real key even though it is never used for anything:
 * with the emulator hosts set, the Admin SDK signs nothing and verifies
 * nothing against Google. Generating it means there is no private key in the
 * repository, not even a fake one somebody might later mistake for real.
 */
process.env.FIREBASE_ADMIN_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

/* -------------------------------------------------------------------------- */
/*  Accounts                                                                  */
/* -------------------------------------------------------------------------- */

const IDENTITY = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;

interface Account {
  uid: string;
  email: string;
  token: string;
}

/**
 * Make an account in the Auth emulator and get an ID token for it.
 *
 * The emulator accepts any API key and any password — nothing here is a
 * credential, and none of it exists outside the emulator process.
 */
async function signUp(email: string): Promise<Account> {
  const response = await fetch(`${IDENTITY}/accounts:signUp?key=emulator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "emulator-only", returnSecureToken: true }),
  });
  const data = (await response.json()) as { idToken?: string; localId?: string; error?: unknown };
  assert.ok(data.idToken && data.localId, `sign up failed: ${JSON.stringify(data)}`);
  return { uid: data.localId, email, token: data.idToken };
}

/** A fresh token, so a claim set since the last one is carried. */
async function refresh(account: Account): Promise<Account> {
  const response = await fetch(`${IDENTITY}/accounts:signInWithPassword?key=emulator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: account.email,
      password: "emulator-only",
      returnSecureToken: true,
    }),
  });
  const data = (await response.json()) as { idToken?: string };
  assert.ok(data.idToken, "could not refresh the token");
  return { ...account, token: data.idToken };
}

/* -------------------------------------------------------------------------- */
/*  Calling a route the way Next does                                         */
/* -------------------------------------------------------------------------- */

function request(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  return new Request(`http://localhost:3000${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
}

/**
 * The body, plus the HTTP status under a name of its own.
 *
 * `httpStatus` rather than `status` because the support routes return a
 * `status` field of their own — the ticket's — and a wrapper that overwrote it
 * made a passing assertion compare 200 against "pending".
 */
async function json<T>(response: Response): Promise<T & { httpStatus: number }> {
  const body = (await response.json()) as T;
  return { ...body, httpStatus: response.status };
}

/* -------------------------------------------------------------------------- */

let customer: Account;
let stranger: Account;
let owner: Account; // the shop's admin
let colleague: Account; // appointed during the test

let support: typeof import("../src/app/api/support/route");
let adminSupport: typeof import("../src/app/api/admin/support/route");
let team: typeof import("../src/app/api/admin/team/route");
let invite: typeof import("../src/app/api/gift/invite/route");
let warehouse: typeof import("../src/app/api/admin/warehouse/route");
let productState: typeof import("../src/app/api/admin/products/state/route");
let products: typeof import("../src/app/api/admin/products/route");
let adminSdk: typeof import("../src/lib/firebase/admin");

before(async () => {
  // Imported after the env above, so every module initialises against the
  // emulators rather than the real project.
  support = await import("../src/app/api/support/route");
  adminSupport = await import("../src/app/api/admin/support/route");
  team = await import("../src/app/api/admin/team/route");
  invite = await import("../src/app/api/gift/invite/route");
  warehouse = await import("../src/app/api/admin/warehouse/route");
  productState = await import("../src/app/api/admin/products/state/route");
  products = await import("../src/app/api/admin/products/route");
  adminSdk = await import("../src/lib/firebase/admin");

  customer = await signUp("customer@example.test");
  stranger = await signUp("stranger@example.test");
  owner = await signUp("owner@example.test");
  colleague = await signUp("colleague@example.test");

  // The bootstrap admin, exactly as `npm run grant-admin` does it.
  await adminSdk.setUserRole(owner.uid, "admin");
  owner = await refresh(owner);
});

after(async () => {
  const db = adminSdk.getAdminDb();
  for (const name of ["tickets", "auditLog", "giftCampaigns", "products"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
});

/* -------------------------------------------------------------------------- */
/*  The conversation                                                          */
/* -------------------------------------------------------------------------- */

describe("support chat", () => {
  let ticketId = "";

  test("a signed-out visitor cannot open or read a thread", async () => {
    const posted = await support.POST(
      request("/api/support", { method: "POST", body: JSON.stringify({ body: "hello" }) }),
    );
    assert.equal(posted.status, 401);

    const read = await support.GET(request("/api/support"));
    assert.equal(read.status, 401);
  });

  test("a customer opens a thread and it is really stored", async () => {
    const response = await json<{ ok: boolean; ticketId: string; reference: string }>(
      await support.POST(
        request("/api/support", {
          method: "POST",
          token: customer.token,
          body: JSON.stringify({
            body: "My order says delivered but nothing arrived.",
            topic: "delivery",
            locale: "en",
          }),
        }),
      ),
    );

    assert.equal(response.ok, true);
    assert.match(response.reference, /^SUP-/);
    ticketId = response.ticketId;

    // Read back from Firestore, not from the response that claimed to write it.
    const stored = await adminSdk.getAdminDb().collection("tickets").doc(ticketId).get();
    assert.equal(stored.exists, true);
    const data = stored.data()!;
    assert.equal(data.uid, customer.uid);
    assert.equal(data.status, "open");
    assert.equal(data.priority, "normal");
    assert.equal(data.messages.length, 1);
    assert.equal(data.messages[0].fromStaff, false);
    // The subject was taken from the message, not left blank.
    assert.equal(String(data.subject).length > 0, true);
    // Numbers, so the inbox can order on them.
    assert.equal(typeof data.createdAt, "number");
    assert.equal(typeof data.updatedAt, "number");
  });

  test("the customer reads their own thread, and nobody else's", async () => {
    const mine = await json<{ tickets: { id: string }[] }>(
      await support.GET(request("/api/support", { token: customer.token })),
    );
    assert.equal(mine.tickets.length, 1);
    assert.equal(mine.tickets[0]!.id, ticketId);

    const theirs = await json<{ tickets: unknown[] }>(
      await support.GET(request("/api/support", { token: stranger.token })),
    );
    assert.equal(theirs.tickets.length, 0);
  });

  test("a stranger cannot write into someone else's thread", async () => {
    const response = await support.POST(
      request("/api/support", {
        method: "POST",
        token: stranger.token,
        body: JSON.stringify({ ticketId, body: "Refunded — no need to pay." }),
      }),
    );
    assert.equal(response.status, 403);

    const stored = await adminSdk.getAdminDb().collection("tickets").doc(ticketId).get();
    assert.equal(stored.data()!.messages.length, 1, "the thread must be untouched");
  });

  test("a customer cannot answer as support", async () => {
    // Even against their own ticket: `fromStaff` is set by the server.
    await support.POST(
      request("/api/support", {
        method: "POST",
        token: customer.token,
        body: JSON.stringify({ ticketId, body: "posing as staff", fromStaff: true }),
      }),
    );

    const stored = await adminSdk.getAdminDb().collection("tickets").doc(ticketId).get();
    const messages = stored.data()!.messages as { fromStaff: boolean }[];
    assert.equal(
      messages.some((message) => message.fromStaff),
      false,
      "no message may be marked as coming from staff",
    );
  });

  test("a customer cannot reply through the staff route", async () => {
    const response = await adminSupport.POST(
      request("/api/admin/support", {
        method: "POST",
        token: customer.token,
        body: JSON.stringify({ ticketId, body: "We have refunded you." }),
      }),
    );
    assert.equal(response.status, 403);
  });

  test("staff reply lands in the same thread the customer is reading", async () => {
    const replied = await json<{ ok: boolean; status: string; delivered: boolean }>(
      await adminSupport.POST(
        request("/api/admin/support", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ ticketId, body: "Sorry — we are sending a replacement today." }),
        }),
      ),
    );
    assert.equal(replied.ok, true);
    assert.equal(replied.status, "pending");
    // Stored, and honest that no email went out.
    assert.equal(replied.delivered, false);

    const mine = await json<{
      tickets: {
        status: string;
        messages: { fromStaff: boolean; authorId: string; body: string }[];
      }[];
    }>(await support.GET(request("/api/support", { token: customer.token })));

    const thread = mine.tickets[0]!;
    const staffMessage = thread.messages.find((message) => message.fromStaff);
    assert.ok(staffMessage, "the customer must be able to read the reply");
    assert.equal(staffMessage.body, "Sorry — we are sending a replacement today.");
    // The staff member's uid is not handed to the customer.
    assert.equal(staffMessage.authorId, "support");
    assert.notEqual(staffMessage.authorId, owner.uid);
  });

  test("the first-response metric is a number, not NaN", async () => {
    const stored = await adminSdk.getAdminDb().collection("tickets").doc(ticketId).get();
    const minutes = stored.data()!.firstResponseMinutes;
    assert.equal(typeof minutes, "number");
    assert.equal(Number.isFinite(minutes), true, "NaN is how this metric used to be written");
  });

  test("a customer's reply reopens a thread support had answered", async () => {
    await support.POST(
      request("/api/support", {
        method: "POST",
        token: customer.token,
        body: JSON.stringify({ ticketId, body: "It still has not come." }),
      }),
    );

    const stored = await adminSdk.getAdminDb().collection("tickets").doc(ticketId).get();
    assert.equal(stored.data()!.status, "open");
  });

  test("staff can resolve it, and the resolution is stored", async () => {
    // The board used to move the pill in local state and store nothing.
    await adminSupport.POST(
      request("/api/admin/support", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ ticketId, status: "resolved" }),
      }),
    );

    const stored = await adminSdk.getAdminDb().collection("tickets").doc(ticketId).get();
    assert.equal(stored.data()!.status, "resolved");
  });

  test("staff read the inbox; a customer does not", async () => {
    const staffView = await json<{ tickets: unknown[] }>(
      await adminSupport.GET(request("/api/admin/support", { token: owner.token })),
    );
    assert.equal(staffView.tickets.length, 1);

    const customerView = await adminSupport.GET(
      request("/api/admin/support", { token: customer.token }),
    );
    assert.equal(customerView.status, 403);
  });
});

/* -------------------------------------------------------------------------- */
/*  Access                                                                    */
/* -------------------------------------------------------------------------- */

describe("appointing staff", () => {
  test("a customer cannot appoint anybody", async () => {
    const response = await team.POST(
      request("/api/admin/team", {
        method: "POST",
        token: customer.token,
        body: JSON.stringify({ email: customer.email, role: "admin" }),
      }),
    );
    assert.equal(response.status, 403);

    const user = await adminSdk.getAdminAuth().getUser(customer.uid);
    assert.notEqual(user.customClaims?.role, "admin", "self-promotion must be impossible");
  });

  test("an admin appoints a colleague, and the claim is really set", async () => {
    const response = await json<{ ok: boolean; role: string; note: string }>(
      await team.POST(
        request("/api/admin/team", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ email: colleague.email, role: "staff" }),
        }),
      ),
    );

    assert.equal(response.ok, true);
    assert.equal(response.role, "staff");
    // The part that produces "it did not work" if it goes unsaid.
    assert.match(response.note, /sign out and back in/i);

    const user = await adminSdk.getAdminAuth().getUser(colleague.uid);
    assert.equal(user.customClaims?.role, "staff");
  });

  test("the change is written to the audit log", async () => {
    const snap = await adminSdk
      .getAdminDb()
      .collection("auditLog")
      .where("action", "==", "team.role")
      .get();

    const entry = snap.docs.map((doc) => doc.data()).find((row) => row.targetUid === colleague.uid);
    assert.ok(entry, "a privilege change nobody can reconstruct is how access quietly persists");
    assert.equal(entry.actorUid, owner.uid);
    assert.equal(entry.from, "customer");
    assert.equal(entry.to, "staff");
  });

  test("staff may see who has access but not change it", async () => {
    colleague = await refresh(colleague);

    const read = await json<{ ok: boolean; members: { role: string }[] }>(
      await team.GET(request("/api/admin/team", { token: colleague.token })),
    );
    assert.equal(read.ok, true);
    assert.equal(read.members.length >= 2, true);

    const write = await team.POST(
      request("/api/admin/team", {
        method: "POST",
        token: colleague.token,
        body: JSON.stringify({ email: colleague.email, role: "admin" }),
      }),
    );
    assert.equal(write.status, 403);
    assert.equal(
      (await adminSdk.getAdminAuth().getUser(colleague.uid)).customClaims?.role,
      "staff",
    );
  });

  test("an admin cannot change their own role", async () => {
    const response = await json<{ reason: string }>(
      await team.POST(
        request("/api/admin/team", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ email: owner.email, role: "customer" }),
        }),
      ),
    );
    assert.equal(response.reason, "self");
    assert.equal((await adminSdk.getAdminAuth().getUser(owner.uid)).customClaims?.role, "admin");
  });

  test("the last admin cannot be removed", async () => {
    // Promote the colleague, then try to remove them while they are the only
    // *other* admin — and then try to remove the last one standing.
    await team.POST(
      request("/api/admin/team", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ uid: colleague.uid, role: "admin" }),
      }),
    );

    // Two admins now: removing one is allowed.
    const allowed = await json<{ ok: boolean }>(
      await team.POST(
        request("/api/admin/team", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ uid: colleague.uid, role: "customer" }),
        }),
      ),
    );
    assert.equal(allowed.ok, true);

    // One admin left — and they are the caller, so this is refused twice over.
    const refused = await json<{ ok: boolean; reason: string }>(
      await team.POST(
        request("/api/admin/team", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ uid: owner.uid, role: "customer" }),
        }),
      ),
    );
    assert.equal(refused.ok, false);
    assert.equal((await adminSdk.getAdminAuth().getUser(owner.uid)).customClaims?.role, "admin");
  });

  test("an address with no account is refused rather than pretended", async () => {
    const response = await json<{ ok: boolean; error: string }>(
      await team.POST(
        request("/api/admin/team", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ email: "nobody@example.test", role: "staff" }),
        }),
      ),
    );
    assert.equal(response.ok, false);
    assert.equal(response.httpStatus, 404);
    assert.match(response.error, /sign in to the shop once/i);
  });
});

/* -------------------------------------------------------------------------- */
/*  Options and variants survive a save                                       */
/* -------------------------------------------------------------------------- */

describe("colours, sizes and variants round-trip", () => {
  const id = "e2e-options-tee";

  /*
   * Every save carries the product's required fields. The route validates the
   * whole document on each write, so a "just change the variants" call still
   * has to be a complete product — otherwise the failure under test is masked
   * by a missing title.
   */
  const required = {
    slug: "e2e-options-tee",
    title: { en: "Options tee", ar: "تي شيرت الخيارات" },
    categoryId: "tees",
    type: "variable",
    price: 12,
    status: "draft",
  };

  const save = async (body: Record<string, unknown>) =>
    json<{ ok: boolean; error?: string; id?: string }>(
      await products.POST(
        request("/api/admin/products", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ id, ...required, ...body }),
        }),
      ),
    );

  test("a product saved with colours and sizes keeps them", async () => {
    /*
     * The bug this pins: `colors` and `sizes` were never read from the body —
     * only seeded as empty arrays on create. A product made in the admin could
     * therefore never have an option, and its variant table had nothing to
     * render.
     */
    const result = await save({
      slug: "e2e-options-tee",
      title: { en: "Options tee", ar: "تي شيرت الخيارات" },
      categoryId: "tees",
      type: "variable",
      price: 12,
      status: "draft",
      colors: [
        { id: "white", name: { en: "White", ar: "أبيض" }, hex: "#FBFAF3" },
        { id: "cobalt", name: { en: "Cobalt", ar: "كوبالت" }, hex: "#1F44B8" },
      ],
      sizes: [
        { id: "m", label: "M", system: "alpha" },
        { id: "l", label: "L", system: "alpha" },
      ],
      variants: [
        { sku: "TEE-WHT-M", colorId: "white", sizeId: "m", stock: 5 },
        { sku: "TEE-WHT-L", colorId: "white", sizeId: "l", stock: 3, priceOverride: 13 },
        { sku: "TEE-COB-M", colorId: "cobalt", sizeId: "m", stock: 0 },
      ],
    });
    assert.equal(result.ok, true, result.error);

    const stored = (await adminSdk.getAdminDb().collection("products").doc(id).get()).data()!;
    assert.equal(stored.colors.length, 2);
    assert.equal(stored.colors[1].id, "cobalt");
    assert.equal(stored.colors[1].name.ar, "كوبالت");
    assert.equal(stored.sizes.length, 2);
    assert.equal(stored.variants.length, 3);
  });

  test("each unit keeps its own price and count", async () => {
    const stored = (await adminSdk.getAdminDb().collection("products").doc(id).get()).data()!;
    const rows = stored.variants as { sku: string; stock: number; priceOverride?: number }[];

    assert.equal(rows.find((r) => r.sku === "TEE-WHT-L")!.priceOverride, 13);
    // A unit without an override has none stored — it sells at the product price.
    assert.equal("priceOverride" in rows.find((r) => r.sku === "TEE-WHT-M")!, false);
    assert.equal(rows.find((r) => r.sku === "TEE-COB-M")!.stock, 0);
  });

  test("totalStock is derived from the rows, never accepted alongside them", async () => {
    // Two numbers that must agree eventually will not; the rows are the ones
    // the checkout decrements, so they are the ones that count.
    const stored = (await adminSdk.getAdminDb().collection("products").doc(id).get()).data()!;
    assert.equal(stored.totalStock, 8);
  });

  test("two units sharing a code are refused", async () => {
    const result = await save({
      variants: [
        { sku: "TEE-DUP", colorId: "white", sizeId: "m", stock: 1 },
        { sku: "tee dup", colorId: "cobalt", sizeId: "m", stock: 1 },
      ],
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /code/i);
  });

  test("a unit with no code is refused", async () => {
    const result = await save({
      variants: [{ sku: "   ", colorId: "white", sizeId: "m", stock: 1 }],
    });
    assert.equal(result.ok, false);
  });

  test("two colours sharing an id are refused", async () => {
    const result = await save({
      colors: [
        { id: "white", name: { en: "White", ar: "أبيض" }, hex: "#FFFFFF" },
        { id: "white", name: { en: "Off white", ar: "أبيض مكسور" }, hex: "#EEEEEE" },
      ],
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /id/i);
  });

  test("an unrenderable hex falls back rather than being stored", async () => {
    await save({
      colors: [{ id: "murky", name: { en: "Murky", ar: "غامق" }, hex: "not-a-colour" }],
    });
    const stored = (await adminSdk.getAdminDb().collection("products").doc(id).get()).data()!;
    assert.match(stored.colors[0].hex, /^#[0-9A-Fa-f]{6}$/);
  });

  test("quantity tiers are stored sorted, and a nonsense tier is refused", async () => {
    const ok = await save({
      priceTiers: [
        { minQuantity: 6, unitPrice: 10 },
        { minQuantity: 3, unitPrice: 11 },
      ],
    });
    assert.equal(ok.ok, true, ok.error);

    const stored = (await adminSdk.getAdminDb().collection("products").doc(id).get()).data()!;
    assert.deepEqual(
      (stored.priceTiers as { minQuantity: number }[]).map((t) => t.minQuantity),
      [3, 6],
    );

    const bad = await save({ priceTiers: [{ minQuantity: 1, unitPrice: 11 }] });
    assert.equal(bad.ok, false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Product state, in bulk                                                    */
/* -------------------------------------------------------------------------- */

describe("product state actions", () => {
  const complete = "e2e-state-complete";
  const incomplete = "e2e-state-incomplete";

  const base = {
    slug: "e2e-tee",
    title: { en: "State tee", ar: "تي شيرت الحالة" },
    categoryId: "tees",
    type: "simple",
    price: 12,
    currency: "JOD",
    images: [{ url: "/a.jpg", alt: "a", width: 800, height: 1000 }],
    colors: [],
    sizes: [],
    variants: [],
    tags: [],
    badges: [],
    inStock: true,
    totalStock: 5,
    status: "draft",
  };

  before(async () => {
    const db = adminSdk.getAdminDb();
    await db.collection("products").doc(complete).set(base);
    // Missing the Arabic title and any image — publishable only after editing.
    await db
      .collection("products")
      .doc(incomplete)
      .set({ ...base, slug: "e2e-half", title: { en: "Half", ar: "" }, images: [] });
  });

  const act = async (ids: string[], action: string, token = owner.token) =>
    json<{
      ok: boolean;
      changed: number;
      requested: number;
      refused: { id: string; reason?: string }[];
    }>(
      await productState.POST(
        request("/api/admin/products/state", {
          method: "POST",
          token,
          body: JSON.stringify({ ids, action }),
        }),
      ),
    );

  test("a bulk publish reports the ones it could not do, and still does the rest", async () => {
    /*
     * The behaviour that makes bulk usable: one unpublishable product must not
     * fail the other. A merchant selecting thirty needs "29 published, 1
     * refused, here is which", not a single error.
     */
    const result = await act([complete, incomplete], "publish");

    assert.equal(result.ok, true);
    assert.equal(result.changed, 1);
    assert.equal(result.requested, 2);
    assert.equal(result.refused.length, 1);
    assert.equal(result.refused[0]!.id, incomplete);
    assert.match(result.refused[0]!.reason ?? "", /title\.ar|images/);

    const db = adminSdk.getAdminDb();
    assert.equal((await db.collection("products").doc(complete).get()).data()!.status, "active");
    assert.equal((await db.collection("products").doc(incomplete).get()).data()!.status, "draft");
  });

  test("stopping a sale never touches the stock count", async () => {
    const db = adminSdk.getAdminDb();
    await act([complete], "sold-out");

    const stored = (await db.collection("products").doc(complete).get()).data()!;
    assert.equal(stored.saleState, "sold-out");
    assert.equal(stored.totalStock, 5, "a manual stop must not zero the count");
    assert.equal(stored.status, "active", "nor unpublish it");
  });

  test("resuming refuses when the shelves are actually empty", async () => {
    const db = adminSdk.getAdminDb();
    await db.collection("products").doc(complete).set({ totalStock: 0, inStock: false }, { merge: true });

    const result = await act([complete], "restock");
    assert.equal(result.changed, 0);
    assert.match(result.refused[0]!.reason ?? "", /stock/i);

    // Put the units back; now it resumes.
    await db.collection("products").doc(complete).set({ totalStock: 5, inStock: true }, { merge: true });
    const second = await act([complete], "restock");
    assert.equal(second.changed, 1);
    assert.equal((await db.collection("products").doc(complete).get()).data()!.saleState, "auto");
  });

  test("moving to the warehouse leaves stock and publication alone", async () => {
    const db = adminSdk.getAdminDb();
    await act([complete], "warehouse");

    const stored = (await db.collection("products").doc(complete).get()).data()!;
    assert.equal(stored.visibility, "hidden");
    assert.equal(stored.visibilityOverride, true);
    assert.equal(stored.totalStock, 5);
    assert.equal(stored.status, "active");
  });

  test("returning a draft to the shopfront does not publish it", async () => {
    const result = await act([incomplete], "shopfront");
    assert.equal(result.changed, 0);
    assert.equal(
      (await adminSdk.getAdminDb().collection("products").doc(incomplete).get()).data()!.status,
      "draft",
    );
  });

  test("restore lands in draft, not straight back on sale", async () => {
    const db = adminSdk.getAdminDb();
    await act([complete], "archive");
    assert.equal((await db.collection("products").doc(complete).get()).data()!.status, "archived");

    await act([complete], "restore");
    assert.equal((await db.collection("products").doc(complete).get()).data()!.status, "draft");
  });

  test("a repeated action changes nothing and says so", async () => {
    const result = await act([complete], "restore");
    assert.equal(result.changed, 0);
    assert.equal(result.refused.length, 1);
  });

  test("every change is written to the audit log with who did it", async () => {
    const snap = await adminSdk
      .getAdminDb()
      .collection("auditLog")
      .where("action", "==", "product.archive")
      .get();
    const entry = snap.docs.map((d) => d.data())[0];
    assert.ok(entry, "a state change nobody can trace is how a shop loses track of itself");
    assert.equal(entry.actorUid, owner.uid);
  });

  test("a customer cannot change product state", async () => {
    const response = await productState.POST(
      request("/api/admin/products/state", {
        method: "POST",
        token: customer.token,
        body: JSON.stringify({ ids: [complete], action: "publish" }),
      }),
    );
    assert.equal(response.status, 403);
  });
});

/* -------------------------------------------------------------------------- */
/*  Warehouse scheduling                                                      */
/* -------------------------------------------------------------------------- */

describe("warehouse scheduling", () => {
  const productId = "e2e-scheduled-tee";

  test("a schedule is stored inside the map, not as a dotted field name", async () => {
    /*
     * The bug this pins down: the route wrote `{"visibilitySchedule.showAt":
     * n}` through `set(..., {merge: true})`. `update()` reads a dotted key as
     * a path into a map; `set()` does not — it creates a top-level field whose
     * *name* contains a dot. So every schedule landed beside
     * `visibilitySchedule` rather than inside it, the reader never saw one,
     * and the feature had never fired once.
     */
    const db = adminSdk.getAdminDb();
    await db.collection("products").doc(productId).set({
      title: { en: "Scheduled tee", ar: "تي شيرت مجدول" },
      status: "active",
      visibility: "visible",
    });

    const showAt = Date.UTC(2026, 9, 1, 6, 0, 0);
    const hideAt = Date.UTC(2026, 9, 30, 21, 0, 0);

    const response = await json<{ ok: boolean }>(
      await warehouse.POST(
        request("/api/admin/warehouse", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ ids: [productId], showAt, hideAt }),
        }),
      ),
    );
    assert.equal(response.ok, true);

    const stored = (await db.collection("products").doc(productId).get()).data()!;

    // The map, read the way the storefront reads it.
    assert.equal(typeof stored.visibilitySchedule, "object");
    assert.equal(stored.visibilitySchedule.showAt, showAt);
    assert.equal(stored.visibilitySchedule.hideAt, hideAt);

    // And nothing named with a literal dot, which is what used to be written.
    assert.equal(
      Object.keys(stored).some((k) => k.includes(".")),
      false,
      `no field name may contain a dot — found ${Object.keys(stored).join(", ")}`,
    );
  });

  test("writing one bound does not erase the other", async () => {
    const db = adminSdk.getAdminDb();
    const newShow = Date.UTC(2026, 10, 5, 6, 0, 0);

    await warehouse.POST(
      request("/api/admin/warehouse", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ ids: [productId], showAt: newShow }),
      }),
    );

    const stored = (await db.collection("products").doc(productId).get()).data()!;
    assert.equal(stored.visibilitySchedule.showAt, newShow);
    // `hideAt` was not in this request; a merged map must leave it alone.
    assert.equal(stored.visibilitySchedule.hideAt, Date.UTC(2026, 9, 30, 21, 0, 0));
  });

  test("clearing one bound removes only that key", async () => {
    const db = adminSdk.getAdminDb();

    await warehouse.POST(
      request("/api/admin/warehouse", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ ids: [productId], hideAt: null }),
      }),
    );

    const stored = (await db.collection("products").doc(productId).get()).data()!;
    assert.equal("hideAt" in stored.visibilitySchedule, false);
    assert.equal(typeof stored.visibilitySchedule.showAt, "number");
  });

  test("clearing the schedule removes the map entirely", async () => {
    const db = adminSdk.getAdminDb();

    await warehouse.POST(
      request("/api/admin/warehouse", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ ids: [productId], clearSchedule: true }),
      }),
    );

    const stored = (await db.collection("products").doc(productId).get()).data()!;
    assert.equal("visibilitySchedule" in stored, false);
  });

  test("moving to the warehouse does not touch stock", async () => {
    const db = adminSdk.getAdminDb();
    await db.collection("products").doc(productId).set({ totalStock: 42 }, { merge: true });

    await warehouse.POST(
      request("/api/admin/warehouse", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ ids: [productId], visibility: "hidden" }),
      }),
    );

    const stored = (await db.collection("products").doc(productId).get()).data()!;
    assert.equal(stored.visibility, "hidden");
    assert.equal(stored.totalStock, 42, "hiding a product must never zero its stock");
  });

  test("a customer cannot move stock off sale", async () => {
    const response = await warehouse.POST(
      request("/api/admin/warehouse", {
        method: "POST",
        token: customer.token,
        body: JSON.stringify({ ids: [productId], visibility: "hidden" }),
      }),
    );
    assert.equal(response.status, 403);
  });
});

/* -------------------------------------------------------------------------- */
/*  The gift invitation                                                       */
/* -------------------------------------------------------------------------- */

describe("gift invitation", () => {
  test("a signed-out visitor is never invited", async () => {
    const response = await invite.GET(request("/api/gift/invite"));
    assert.equal(response.status, 401);
  });

  test("no campaign means no invitation", async () => {
    const response = await json<{ eligible: boolean; reason: string }>(
      await invite.GET(request("/api/gift/invite", { token: customer.token })),
    );
    assert.equal(response.eligible, false);
    assert.equal(response.reason, "no-campaign");
  });

  test("an active campaign invites a customer who has not played", async () => {
    const now = Date.now();
    await adminSdk.getAdminDb().collection("giftCampaigns").doc("e2e").set({
      name: { en: "Autumn spin", ar: "دورة الخريف" },
      kind: "wheel",
      status: "active",
      startsAt: now - 3_600_000,
      endsAt: now + 3_600_000,
      cooldownHours: 24,
      prizes: [
        { id: "p1", label: { en: "10% off", ar: "خصم ١٠٪" }, reward: "percentage", value: 10, validForDays: 7, weight: 1, issued: 0 },
        { id: "p2", label: { en: "No prize", ar: "حظاً أوفر" }, reward: "none", value: 0, validForDays: 1, weight: 1, issued: 0 },
      ],
    });

    const response = await json<{
      eligible: boolean;
      attempts: number;
      campaign: { id: string; prizes: unknown[] };
    }>(await invite.GET(request("/api/gift/invite", { token: customer.token })));

    assert.equal(response.eligible, true);
    // The turn marker the browser stores, so one dismissal is remembered.
    assert.equal(response.attempts, 0);
    assert.equal(response.campaign.id, "e2e");
    assert.equal(response.campaign.prizes.length, 2);
  });

  test("a customer inside a cooldown is not invited", async () => {
    await adminSdk.getAdminDb().collection("giftPlays").add({
      campaignId: "e2e",
      uid: customer.uid,
      prizeId: "p1",
      playedAt: Date.now(),
    });

    const response = await json<{ eligible: boolean; reason: string; campaign?: unknown }>(
      await invite.GET(request("/api/gift/invite", { token: customer.token })),
    );
    assert.equal(response.eligible, false);
    assert.equal(response.reason, "cooldown");
    // No wheel is sent to a browser that cannot spin it.
    assert.equal(response.campaign, undefined);
  });
});
