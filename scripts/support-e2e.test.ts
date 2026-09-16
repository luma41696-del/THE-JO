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
/*
 * The Storage emulator, for the media route.
 *
 * Without it, deleting a file reaches the real Cloud Storage API and fails
 * with `invalid_grant` — a fake project has no service account. That would
 * leave the one path that actually removes something untested, so the
 * emulator handles it instead. `STORAGE_EMULATOR_HOST` is what the Admin
 * SDK reads, and it wants a scheme where the other two do not.
 */
process.env.STORAGE_EMULATOR_HOST ??= "http://127.0.0.1:9199";
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
let media: typeof import("../src/app/api/admin/media/route");
let bulk: typeof import("../src/app/api/admin/products/bulk/route");
let importRoute: typeof import("../src/app/api/admin/products/import/route");
let loyalty: typeof import("../src/app/api/loyalty/route");
let offersLib: typeof import("../src/lib/offers");
let alerts: typeof import("../src/app/api/alerts/route");
let adminAlerts: typeof import("../src/app/api/admin/alerts/route");
let tryOn: typeof import("../src/app/api/fitting/try-on/route");
let fittingProfile: typeof import("../src/app/api/fitting/profile/route");
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
  media = await import("../src/app/api/admin/media/route");
  bulk = await import("../src/app/api/admin/products/bulk/route");
  importRoute = await import("../src/app/api/admin/products/import/route");
  loyalty = await import("../src/app/api/loyalty/route");
  offersLib = await import("../src/lib/offers");
  alerts = await import("../src/app/api/alerts/route");
  adminAlerts = await import("../src/app/api/admin/alerts/route");
  tryOn = await import("../src/app/api/fitting/try-on/route");
  fittingProfile = await import("../src/app/api/fitting/profile/route");
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
  for (const name of ["tickets", "auditLog", "giftCampaigns", "products", "media", "categories", "importJobs", "offers", "loyalty", "stockAlerts", "tryOnJobs", "users"]) {
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

  test("a second window's save is refused rather than silently overwriting", async () => {
    /*
     * Two people with the same product open. Without this, the second save
     * wins and the first person's work disappears with no error and no trace —
     * discovered later, if at all, as a wrong price.
     */
    const db = adminSdk.getAdminDb();
    const before = (await db.collection("products").doc(id).get()).data()!;
    const staleVersion = Number(
      before.updatedAt?.toMillis?.() ?? before.updatedAt ?? 0,
    );

    // The other window saves first.
    const first = await save({ price: 15 });
    assert.equal(first.ok, true, first.error);

    // Ours still holds the version we loaded.
    const second = await json<{ ok: boolean; conflict?: boolean; error?: string }>(
      await products.POST(
        request("/api/admin/products", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({
            id,
            ...required,
            price: 99,
            expectedUpdatedAt: staleVersion,
          }),
        }),
      ),
    );

    assert.equal(second.ok, false);
    assert.equal(second.conflict, true);
    assert.equal(second.httpStatus, 409);

    // And the first writer's value is still there.
    const after = (await db.collection("products").doc(id).get()).data()!;
    assert.equal(after.price, 15, "the losing save must not have landed");
  });

  test("a save that carries the current version goes through", async () => {
    const db = adminSdk.getAdminDb();
    const current = (await db.collection("products").doc(id).get()).data()!;
    const version = Number(current.updatedAt?.toMillis?.() ?? current.updatedAt ?? 0);

    const result = await json<{ ok: boolean; error?: string }>(
      await products.POST(
        request("/api/admin/products", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ id, ...required, price: 16, expectedUpdatedAt: version }),
        }),
      ),
    );
    assert.equal(result.ok, true, result.error);
    assert.equal((await db.collection("products").doc(id).get()).data()!.price, 16);
  });

  test("a caller with no version — an import — is not blocked", async () => {
    // A script that never read the document is not claiming to know its
    // version, and refusing those would only punish the careful caller.
    const result = await save({ price: 17 });
    assert.equal(result.ok, true, result.error);
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
/* -------------------------------------------------------------------------- */
/*  The media library, and the deletions it refuses                           */
/* -------------------------------------------------------------------------- */

describe("media library", () => {
  const BUCKET = "https://firebasestorage.googleapis.com/v0/b/netsale-e2e-test.appspot.com/o";
  const asUrl = (path: string, token = "t1") =>
    `${BUCKET}/${encodeURIComponent(path)}?alt=media&token=${token}`;

  const SHARED = asUrl("products/e2e-media/shared-chart.jpg");
  const SOLO = asUrl("products/e2e-media/solo-shot.jpg");

  const base = {
    categoryId: "tees",
    type: "simple",
    price: 10,
    status: "draft",
  };

  const saveProduct = async (id: string, body: Record<string, unknown>) =>
    json<{ ok: boolean; error?: string }>(
      await products.POST(
        request("/api/admin/products", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({ id, ...base, ...body }),
        }),
      ),
    );

  const registerAsset = (url: string, token: string) =>
    media.POST(
      request("/api/admin/media", {
        method: "POST",
        token,
        body: JSON.stringify({
          url,
          alt: "a size chart",
          width: 1200,
          height: 1600,
          bytes: 90_000,
          contentType: "image/jpeg",
          filename: "Shared-Chart.JPG",
        }),
      }),
    );

  const deleteAsset = (url: string, token: string, ignoreProductId?: string) =>
    media.DELETE(
      request("/api/admin/media", {
        method: "DELETE",
        token,
        body: JSON.stringify({ url, ignoreProductId }),
      }),
    );

  before(async () => {
    // Two products sharing one file, which is the situation the old editor
    // destroyed: removing the image from either one deleted it from Storage
    // and left the other displaying a URL with nothing behind it.
    await saveProduct("e2e-media-a", {
      slug: "e2e-media-a",
      title: { en: "Media A", ar: "وسائط أ" },
      images: [
        { url: SHARED, alt: "a size chart", width: 1200, height: 1600 },
        { url: SOLO, alt: "the only one", width: 1200, height: 1600 },
      ],
    });
    await saveProduct("e2e-media-b", {
      slug: "e2e-media-b",
      title: { en: "Media B", ar: "وسائط ب" },
      images: [{ url: SHARED, alt: "a size chart", width: 1200, height: 1600 }],
    });

    await registerAsset(SHARED, owner.token);
    await registerAsset(SOLO, owner.token);
  });

  test("a registered file appears in the library with a real usage count", async () => {
    const listing = await json<{
      ok: boolean;
      assets: { url: string; usageCount: number; usedBy: string[]; filename: string }[];
    }>(
      await media.GET(request("/api/admin/media", { token: owner.token })),
    );

    assert.equal(listing.ok, true);
    const shared = listing.assets.find((asset) => asset.url === SHARED);
    assert.ok(shared, "the registered file should be listed");
    // Counted from the products, never stored — so it cannot go stale.
    assert.equal(shared.usageCount, 2);
    assert.deepEqual(shared.usedBy.sort(), ["e2e-media-a", "e2e-media-b"]);
    assert.equal(shared.filename, "shared-chart.jpg");
  });

  test("searching finds it by filename and by its description", async () => {
    const byName = await json<{ assets: { url: string }[] }>(
      await media.GET(request("/api/admin/media?q=chart", { token: owner.token })),
    );
    assert.equal(byName.assets.some((asset) => asset.url === SHARED), true);

    const byNothing = await json<{ assets: { url: string }[] }>(
      await media.GET(request("/api/admin/media?q=denim", { token: owner.token })),
    );
    assert.equal(byNothing.assets.length, 0);
  });

  test("deleting a file two products use is refused, and says which", async () => {
    /*
     * The heart of it. This request is exactly what the editor sends after a
     * merchant removes the image from product A and saves — and the right
     * answer is no, because product B still shows it.
     */
    const refusal = await json<{
      ok: boolean;
      reason?: string;
      usedBy?: string[];
      error?: string;
    }>(await deleteAsset(SHARED, owner.token, "e2e-media-a"));

    assert.equal(refusal.httpStatus, 409);
    assert.equal(refusal.ok, false);
    assert.equal(refusal.reason, "in-use");
    assert.deepEqual(refusal.usedBy, ["e2e-media-b"]);

    // And it is still in the library, because it is still a real file.
    const listing = await json<{ assets: { url: string }[] }>(
      await media.GET(request("/api/admin/media", { token: owner.token })),
    );
    assert.equal(listing.assets.some((asset) => asset.url === SHARED), true);
  });

  test("the product that still uses it is untouched", async () => {
    // The refusal is only worth anything if the other product survived it.
    const stored = (
      await adminSdk.getAdminDb().collection("products").doc("e2e-media-b").get()
    ).data()!;
    assert.equal(stored.images.length, 1);
    assert.equal(stored.images[0].url, SHARED);
  });

  test("a file nobody else uses is deleted, and leaves the library", async () => {
    await saveProduct("e2e-media-a", {
      slug: "e2e-media-a",
      title: { en: "Media A", ar: "وسائط أ" },
      // SOLO removed — the save the editor makes before it reaps.
      images: [{ url: SHARED, alt: "a size chart", width: 1200, height: 1600 }],
    });

    const result = await json<{ ok: boolean; error?: string }>(
      await deleteAsset(SOLO, owner.token, "e2e-media-a"),
    );
    assert.equal(result.ok, true, result.error);

    const listing = await json<{ assets: { url: string }[] }>(
      await media.GET(request("/api/admin/media", { token: owner.token })),
    );
    assert.equal(listing.assets.some((asset) => asset.url === SOLO), false);
  });

  test("a seeded asset is refused as having no file, not as being in use", async () => {
    const refusal = await json<{ ok: boolean; reason?: string }>(
      await deleteAsset("/demo/cotton-tee.jpg", owner.token),
    );
    assert.equal(refusal.ok, false);
    assert.equal(refusal.reason, "not-a-managed-file");
  });

  test("a customer cannot browse or delete the library", async () => {
    const read = await json<{ ok: boolean }>(
      await media.GET(request("/api/admin/media", { token: customer.token })),
    );
    assert.equal(read.httpStatus, 403);

    const write = await json<{ ok: boolean }>(await deleteAsset(SHARED, customer.token));
    assert.equal(write.httpStatus, 403);
  });

  test("an unsigned request is refused before anything is read", async () => {
    const anonymous = await json<{ ok: boolean }>(
      await media.GET(request("/api/admin/media")),
    );
    assert.equal(anonymous.httpStatus, 401);
  });
});

/* -------------------------------------------------------------------------- */
/*  Quick edit and bulk edit                                                  */
/* -------------------------------------------------------------------------- */

describe("bulk edit", () => {
  const db = () => adminSdk.getAdminDb();

  const seed = async (id: string, body: Record<string, unknown>) =>
    json<{ ok: boolean; error?: string }>(
      await products.POST(
        request("/api/admin/products", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({
            id,
            categoryId: "tees",
            type: "simple",
            status: "draft",
            ...body,
          }),
        }),
      ),
    );

  const edit = async (
    ids: string[],
    edits: Record<string, unknown>[],
    token = owner.token,
  ) =>
    json<{
      ok: boolean;
      error?: string;
      changed?: number;
      refused?: { id: string; title?: string; reason?: string }[];
    }>(
      await bulk.POST(
        request("/api/admin/products/bulk", {
          method: "POST",
          token,
          body: JSON.stringify({ ids, edits }),
        }),
      ),
    );

  before(async () => {
    await seed("e2e-bulk-a", {
      slug: "e2e-bulk-a",
      title: { en: "Bulk A", ar: "جملة أ" },
      price: 20,
      totalStock: 5,
      tags: ["cotton"],
    });
    await seed("e2e-bulk-b", {
      slug: "e2e-bulk-b",
      title: { en: "Bulk B", ar: "جملة ب" },
      price: 40,
      totalStock: 2,
      tags: [],
    });
  });

  test("a percentage cut is computed from the stored price, not from the browser's", async () => {
    /*
     * The reason the route re-reads. "Reduce by 25%" is relative, and the
     * board's copy of the price can be minutes old — a colleague may have
     * repriced it since. Applying the cut to a number the browser remembers
     * discounts a price that no longer exists.
     */
    const result = await edit(["e2e-bulk-a", "e2e-bulk-b"], [
      { field: "price", mode: "decrease", value: 25 },
    ]);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.changed, 2);

    const a = (await db().collection("products").doc("e2e-bulk-a").get()).data()!;
    const b = (await db().collection("products").doc("e2e-bulk-b").get()).data()!;
    assert.equal(a.price, 15);
    assert.equal(b.price, 30);
  });

  test("a change large enough to be a typo is refused before anything is read", async () => {
    const result = await edit(["e2e-bulk-a", "e2e-bulk-b"], [
      { field: "price", mode: "decrease", value: 95 },
    ]);
    assert.equal(result.httpStatus, 400);
    assert.equal(result.ok, false);

    // Nothing moved — the refusal is up front, not per product.
    const a = (await db().collection("products").doc("e2e-bulk-a").get()).data()!;
    assert.equal(a.price, 15);
  });

  test("tags are added without losing the ones already there", async () => {
    const result = await edit(["e2e-bulk-a", "e2e-bulk-b"], [
      { field: "tags", mode: "add", value: "sale, summer" },
    ]);
    assert.equal(result.ok, true, result.error);

    const a = (await db().collection("products").doc("e2e-bulk-a").get()).data()!;
    assert.deepEqual(a.tags.sort(), ["cotton", "sale", "summer"]);
  });

  test("a was-price below the price is refused for that product, and the rest go through", async () => {
    /*
     * The per-product refusal. A selection of two where one cannot take the
     * change should apply to the other and name the one it did not — not fail
     * as a whole and roll back the product that was fine.
     */
    await db().collection("products").doc("e2e-bulk-a").set({ price: 15 }, { merge: true });
    await db().collection("products").doc("e2e-bulk-b").set({ price: 60 }, { merge: true });

    const result = await edit(["e2e-bulk-a", "e2e-bulk-b"], [
      { field: "compareAtPrice", mode: "set", value: 50 },
    ]);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.changed, 1);
    assert.equal(result.refused?.length, 1);
    assert.equal(result.refused?.[0]?.id, "e2e-bulk-b");
    assert.equal(result.refused?.[0]?.reason?.includes("negative discount"), true);

    const a = (await db().collection("products").doc("e2e-bulk-a").get()).data()!;
    assert.equal(a.compareAtPrice, 50);
  });

  test("clearing the was-price removes the field rather than storing a null", async () => {
    const result = await edit(["e2e-bulk-a"], [{ field: "compareAtPrice", mode: "clear" }]);
    assert.equal(result.ok, true, result.error);

    const a = (await db().collection("products").doc("e2e-bulk-a").get()).data()!;
    // A stored `null` would read as a was-price of zero somewhere downstream.
    assert.equal("compareAtPrice" in a, false);
  });

  test("a variable product's stock is refused, and says where to edit it", async () => {
    await seed("e2e-bulk-var", {
      slug: "e2e-bulk-var",
      title: { en: "Bulk variable", ar: "جملة متغيّر" },
      type: "variable",
      price: 12,
      colors: [{ id: "white", name: { en: "White", ar: "أبيض" }, hex: "#FBFAF3" }],
      sizes: [{ id: "m", label: "M", system: "alpha" }],
      variants: [{ sku: "BULK-WHT-M", colorId: "white", sizeId: "m", stock: 4 }],
    });

    const result = await edit(["e2e-bulk-var"], [
      { field: "totalStock", mode: "set", value: 99 },
    ]);
    assert.equal(result.changed, 0);
    assert.equal(result.refused?.[0]?.reason?.includes("options"), true);

    // The real count is still the sum of the rows.
    const stored = (await db().collection("products").doc("e2e-bulk-var").get()).data()!;
    assert.equal(stored.totalStock, 4);
  });

  test("moving a category rewrites the denormalised ancestry with it", async () => {
    /*
     * `categoryPath` is what every listing filters on. Moving a product
     * without recomputing it leaves the product filed under its old parent
     * everywhere it appears — invisible in the admin, wrong on the storefront.
     */
    await db().collection("categories").doc("shirts").set({
      id: "shirts",
      name: { en: "Shirts", ar: "قمصان" },
      slug: "shirts",
      parentId: null,
      order: 1,
    });

    const result = await edit(["e2e-bulk-a"], [
      { field: "categoryId", mode: "set", value: "shirts" },
    ]);
    assert.equal(result.ok, true, result.error);

    const a = (await db().collection("products").doc("e2e-bulk-a").get()).data()!;
    assert.equal(a.categoryId, "shirts");
    assert.deepEqual(a.categoryPath, ["shirts"]);
  });

  test("a slug already taken by another product is refused", async () => {
    // A collision takes a live page down, so this is checked before the write
    // rather than discovered by a customer.
    const result = await edit(["e2e-bulk-a"], [
      { field: "slug", mode: "set", value: "e2e-bulk-b" },
    ]);
    assert.equal(result.httpStatus, 409);
    assert.equal(result.ok, false);
  });

  test("a slug on more than one product is refused outright", async () => {
    const result = await edit(["e2e-bulk-a", "e2e-bulk-b"], [
      { field: "slug", mode: "set", value: "whatever" },
    ]);
    assert.equal(result.httpStatus, 400);
  });

  test("an edit that changes nothing writes nothing, so updatedAt holds still", async () => {
    /*
     * A no-op write would move `updatedAt`, which is what every open editor
     * compares against to detect a conflict — so a bulk action that changed
     * nothing would make everyone else's next save fail.
     */
    const before = (await db().collection("products").doc("e2e-bulk-a").get()).data()!.updatedAt;

    const result = await edit(["e2e-bulk-a"], [{ field: "tags", mode: "add", value: "cotton" }]);
    assert.equal(result.ok, true);
    assert.equal(result.changed, 0);

    const after = (await db().collection("products").doc("e2e-bulk-a").get()).data()!.updatedAt;
    assert.equal(after, before);
  });

  test("the instruction is recorded in the audit log, not just the outcome", async () => {
    const log = await db()
      .collection("auditLog")
      .where("action", "==", "product.bulkEdit")
      .get();
    assert.equal(log.size > 0, true);
    const entry = log.docs[0]!.data();
    assert.equal(entry.actorEmail, "owner@example.test");
    assert.equal(Array.isArray(entry.edits), true);
  });

  test("a customer cannot bulk edit anything", async () => {
    const result = await edit(
      ["e2e-bulk-a"],
      [{ field: "price", mode: "set", value: 1 }],
      customer.token,
    );
    assert.equal(result.httpStatus, 403);

    const a = (await db().collection("products").doc("e2e-bulk-a").get()).data()!;
    assert.notEqual(a.price, 1);
  });
});
/* -------------------------------------------------------------------------- */
/*  Importing a spreadsheet                                                   */
/* -------------------------------------------------------------------------- */

describe("product import", () => {
  const db = () => adminSdk.getAdminDb();

  const seed = async (id: string, body: Record<string, unknown>) =>
    json<{ ok: boolean; error?: string }>(
      await products.POST(
        request("/api/admin/products", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({
            id,
            categoryId: "tees",
            type: "simple",
            status: "draft",
            ...body,
          }),
        }),
      ),
    );

  const send = async (body: Record<string, unknown>, token = owner.token) =>
    json<{
      ok: boolean;
      error?: string;
      created?: number;
      updated?: number;
      applied?: number;
      alreadyApplied?: boolean;
      restored?: number;
      deleted?: number;
      kept?: string[];
      outcomes?: { line: number; ok: boolean; action?: string; id?: string; reason?: string }[];
    }>(
      await importRoute.POST(
        request("/api/admin/products/import", {
          method: "POST",
          token,
          body: JSON.stringify(body),
        }),
      ),
    );

  /** A parsed row in the shape the browser sends. */
  const row = (line: number, values: Record<string, unknown>) => ({ line, values, problems: [] });

  before(async () => {
    await seed("e2e-imp-existing", {
      slug: "e2e-imp-existing",
      title: { en: "Existing tee", ar: "تي شيرت موجود" },
      sku: "IMP-EXIST",
      price: 20,
      totalStock: 5,
    });
  });

  test("a row matching nothing creates a draft, never a live product", async () => {
    /*
     * An import that publishes is an import that puts something on the
     * storefront nobody has looked at. A file that says `status: published`
     * still can — this is only what happens when it says nothing.
     */
    const result = await send({
      jobId: "job-create-001",
      filename: "new.csv",
      total: 1,
      offset: 0,
      rows: [
        row(2, {
          titleEn: "Imported tee",
          titleAr: "تي شيرت مستورد",
          categoryId: "tees",
          price: 9.5,
          totalStock: 3,
        }),
      ],
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.created, 1);

    const id = result.outcomes!.find((outcome) => outcome.action === "create")!.id!;
    const stored = (await db().collection("products").doc(id).get()).data()!;
    assert.equal(stored.status, "draft");
    assert.equal(stored.price, 9.5);
    assert.equal(stored.totalStock, 3);
    // The pair that has to move together, or a listing offers an empty product.
    assert.equal(stored.inStock, true);
    assert.equal(stored.slug.length > 0, true);
    assert.deepEqual(stored.images, []);
  });

  test("a row matching an existing product updates only what it carried", async () => {
    /*
     * The failure this pins: an importer that writes every field would send
     * `description: ""` for a price-list file and erase every description in
     * the catalogue, with nothing in the preview to suggest it would.
     */
    const before = (await db().collection("products").doc("e2e-imp-existing").get()).data()!;

    const result = await send({
      jobId: "job-update-001",
      filename: "prices.csv",
      total: 1,
      offset: 0,
      rows: [row(2, { sku: "IMP-EXIST", price: 24 })],
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.updated, 1);

    const after = (await db().collection("products").doc("e2e-imp-existing").get()).data()!;
    assert.equal(after.price, 24);
    assert.equal(after.title.en, before.title.en);
    assert.equal(after.totalStock, before.totalStock);
  });

  test("re-running the same file writes nothing", async () => {
    // The most common thing a merchant does: run yesterday's file again to be
    // sure. Rewriting every row would move each `updatedAt` and break every
    // open editor's conflict check.
    const before = (await db().collection("products").doc("e2e-imp-existing").get()).data()!;

    const result = await send({
      jobId: "job-update-002",
      filename: "prices.csv",
      total: 1,
      offset: 0,
      rows: [row(2, { sku: "IMP-EXIST", price: 24 })],
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.updated, 0);
    assert.equal(result.outcomes?.[0]?.action, "skip");

    const after = (await db().collection("products").doc("e2e-imp-existing").get()).data()!;
    assert.equal(after.updatedAt, before.updatedAt);
  });

  test("a retried slice is recognised and not applied twice", async () => {
    /*
     * The response was lost, not the write. Without the job's record of how
     * far it got, the retry creates a second copy of every product in the
     * slice — and the merchant has no way to tell which half is the duplicate.
     */
    const first = await send({
      jobId: "job-retry-001",
      filename: "retry.csv",
      total: 1,
      offset: 0,
      rows: [
        row(2, {
          titleEn: "Retried tee",
          titleAr: "تي شيرت معاد",
          categoryId: "tees",
          price: 11,
        }),
      ],
    });
    assert.equal(first.created, 1);

    const again = await send({
      jobId: "job-retry-001",
      filename: "retry.csv",
      total: 1,
      offset: 0,
      rows: [
        row(2, {
          titleEn: "Retried tee",
          titleAr: "تي شيرت معاد",
          categoryId: "tees",
          price: 11,
        }),
      ],
    });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyApplied, true);
    assert.equal(again.created ?? 0, 0);

    const copies = await db()
      .collection("products")
      .where("title.en", "==", "Retried tee")
      .get();
    assert.equal(copies.size, 1);
  });

  test("a second slice carries on from where the first stopped", async () => {
    const first = await send({
      jobId: "job-slices-001",
      filename: "two-slices.csv",
      total: 2,
      offset: 0,
      rows: [row(2, { titleEn: "Slice one", titleAr: "شريحة ١", categoryId: "tees", price: 5 })],
    });
    assert.equal(first.applied, 1);

    const second = await send({
      jobId: "job-slices-001",
      filename: "two-slices.csv",
      total: 2,
      offset: 1,
      rows: [row(3, { titleEn: "Slice two", titleAr: "شريحة ٢", categoryId: "tees", price: 6 })],
    });
    assert.equal(second.applied, 2);
    assert.equal(second.created, 1);

    const job = (await db().collection("importJobs").doc("job-slices-001").get()).data()!;
    assert.equal(job.status, "done");
    assert.equal(job.created, 2);
  });

  test("the plan is recomputed here, against the catalogue as it is now", async () => {
    /*
     * The browser planned this row as a create. In between, the product came
     * into existence. Trusting the browser would make a second copy; planning
     * again makes it the update it now is.
     */
    await seed("e2e-imp-raced", {
      slug: "e2e-imp-raced",
      title: { en: "Raced tee", ar: "تي شيرت سباق" },
      sku: "IMP-RACE",
      price: 12,
    });

    const result = await send({
      jobId: "job-race-001",
      filename: "race.csv",
      total: 1,
      offset: 0,
      rows: [
        row(2, {
          sku: "IMP-RACE",
          titleEn: "Raced tee",
          titleAr: "تي شيرت سباق",
          categoryId: "tees",
          price: 15,
        }),
      ],
    });

    assert.equal(result.created, 0);
    assert.equal(result.updated, 1);
    const stored = (await db().collection("products").doc("e2e-imp-raced").get()).data()!;
    assert.equal(stored.price, 15);
  });

  test("a bad row is refused and the good rows in the same slice still land", async () => {
    const result = await send({
      jobId: "job-mixed-001",
      filename: "mixed.csv",
      total: 2,
      offset: 0,
      rows: [
        row(2, { titleEn: "No price" }),
        row(3, { titleEn: "Fine tee", titleAr: "تي شيرت سليم", categoryId: "tees", price: 8 }),
      ],
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.created, 1);
    const refused = result.outcomes!.find((outcome) => outcome.line === 2)!;
    assert.equal(refused.ok, false);
    assert.equal((refused.reason ?? "").length > 0, true);
  });

  test("the same product twice in one slice is refused the second time", async () => {
    const result = await send({
      jobId: "job-dupe-001",
      filename: "dupe.csv",
      total: 2,
      offset: 0,
      rows: [
        row(2, { sku: "IMP-EXIST", price: 31 }),
        row(3, { sku: "IMP-EXIST", price: 32 }),
      ],
    });

    assert.equal(result.updated, 1);
    assert.equal(result.outcomes!.find((outcome) => outcome.line === 3)!.ok, false);

    // The first one is what applied, because it is the one the merchant can see.
    const stored = (await db().collection("products").doc("e2e-imp-existing").get()).data()!;
    assert.equal(stored.price, 31);
  });

  /* ---- undo ------------------------------------------------------------ */

  test("undo puts back what was changed and removes what was added", async () => {
    await seed("e2e-imp-undo", {
      slug: "e2e-imp-undo",
      title: { en: "Undo tee", ar: "تي شيرت تراجع" },
      sku: "IMP-UNDO",
      price: 40,
      totalStock: 9,
    });

    const applied = await send({
      jobId: "job-undo-001",
      filename: "undo.csv",
      total: 2,
      offset: 0,
      rows: [
        row(2, { sku: "IMP-UNDO", price: 5, totalStock: 1 }),
        row(3, { titleEn: "Undo new", titleAr: "جديد تراجع", categoryId: "tees", price: 7 }),
      ],
    });
    assert.equal(applied.updated, 1);
    assert.equal(applied.created, 1);
    const createdId = applied.outcomes!.find((outcome) => outcome.action === "create")!.id!;

    const undone = await send({ action: "undo", jobId: "job-undo-001" });
    assert.equal(undone.ok, true, undone.error);
    assert.equal(undone.restored, 1);
    assert.equal(undone.deleted, 1);

    const restored = (await db().collection("products").doc("e2e-imp-undo").get()).data()!;
    assert.equal(restored.price, 40);
    assert.equal(restored.totalStock, 9);

    const gone = await db().collection("products").doc(createdId).get();
    assert.equal(gone.exists, false);
  });

  test("undo removes a field the import invented, rather than leaving it", async () => {
    /*
     * The product had no was-price. The import gave it one. Restoring only the
     * fields that had values would leave the invented one in place, and the
     * shop would keep showing a discount nobody set.
     */
    await seed("e2e-imp-undo-field", {
      slug: "e2e-imp-undo-field",
      title: { en: "Field tee", ar: "تي شيرت حقل" },
      sku: "IMP-FIELD",
      price: 20,
    });

    await send({
      jobId: "job-undo-002",
      filename: "field.csv",
      total: 1,
      offset: 0,
      rows: [row(2, { sku: "IMP-FIELD", compareAtPrice: 30 })],
    });
    const withSale = (await db().collection("products").doc("e2e-imp-undo-field").get()).data()!;
    assert.equal(withSale.compareAtPrice, 30);

    await send({ action: "undo", jobId: "job-undo-002" });
    const after = (await db().collection("products").doc("e2e-imp-undo-field").get()).data()!;
    assert.equal("compareAtPrice" in after, false);
  });

  test("undo leaves alone a product somebody edited afterwards, and says which", async () => {
    /*
     * An undo is a statement about *this import's* changes. A product that has
     * moved on since carries a newer, deliberate edit on top, and restoring
     * the old value would throw away work the undo was never asked about.
     */
    await seed("e2e-imp-edited", {
      slug: "e2e-imp-edited",
      title: { en: "Edited tee", ar: "تي شيرت معدّل" },
      sku: "IMP-EDITED",
      price: 50,
    });

    await send({
      jobId: "job-undo-003",
      filename: "edited.csv",
      total: 1,
      offset: 0,
      rows: [row(2, { sku: "IMP-EDITED", price: 10 })],
    });

    // Somebody prices it by hand afterwards.
    await db()
      .collection("products")
      .doc("e2e-imp-edited")
      .set({ price: 33, updatedAt: Date.now() + 60_000 }, { merge: true });

    const undone = await send({ action: "undo", jobId: "job-undo-003" });
    assert.equal(undone.ok, true, undone.error);
    assert.equal(undone.restored, 0);
    assert.equal(undone.kept?.length, 1);

    const stored = (await db().collection("products").doc("e2e-imp-edited").get()).data()!;
    assert.equal(stored.price, 33);
  });

  test("an import cannot be undone twice", async () => {
    const again = await send({ action: "undo", jobId: "job-undo-001" });
    assert.equal(again.httpStatus, 409);
  });

  test("an undone job refuses further slices", async () => {
    // Otherwise a resume after an undo quietly re-applies what was just put back.
    const result = await send({
      jobId: "job-undo-001",
      filename: "undo.csv",
      total: 3,
      offset: 2,
      rows: [row(4, { titleEn: "Late", titleAr: "متأخر", categoryId: "tees", price: 3 })],
    });
    assert.equal(result.httpStatus, 409);
  });

  /* ---- permission ------------------------------------------------------ */

  test("a customer cannot import or undo", async () => {
    const applyAttempt = await send(
      {
        jobId: "job-customer-001",
        filename: "x.csv",
        total: 1,
        offset: 0,
        rows: [row(2, { titleEn: "Nope", titleAr: "لا", categoryId: "tees", price: 1 })],
      },
      customer.token,
    );
    assert.equal(applyAttempt.httpStatus, 403);

    const undoAttempt = await send({ action: "undo", jobId: "job-slices-001" }, customer.token);
    assert.equal(undoAttempt.httpStatus, 403);

    const job = (await db().collection("importJobs").doc("job-slices-001").get()).data()!;
    assert.equal(job.status, "done");
  });

  test("an oversized slice is refused rather than truncated", async () => {
    // Truncating would report success for rows it never wrote.
    const many = Array.from({ length: 101 }, (_, i) =>
      row(i + 2, { titleEn: `Bulk ${i}`, titleAr: `كثير ${i}`, categoryId: "tees", price: 1 }),
    );
    const result = await send({
      jobId: "job-toobig-001",
      filename: "big.csv",
      total: 101,
      offset: 0,
      rows: many,
    });
    assert.equal(result.httpStatus, 400);
  });
});
/* -------------------------------------------------------------------------- */
/*  Points, and turning them into a coupon                                    */
/* -------------------------------------------------------------------------- */

describe("loyalty", () => {
  const db = () => adminSdk.getAdminDb();

  /** One line in a bag, so a coupon has something to discount. */
  const line = {
    key: "p1::",
    productId: "p1",
    sku: "NS-TEE",
    slug: "tee",
    title: { en: "Tee", ar: "تي شيرت" },
    image: { url: "/demo/tee.svg", alt: "tee", width: 8, height: 10 },
    colorId: "",
    colorName: { en: "", ar: "" },
    sizeId: "",
    sizeLabel: "",
    unitPrice: 100,
    currency: "JOD" as const,
    quantity: 1,
    maxQuantity: 5,
  };
  const entriesOf = (uid: string) =>
    db().collection("loyalty").doc(uid).collection("entries");

  const readBalance = async (token: string) =>
    json<{
      ok: boolean;
      error?: string;
      balance?: {
        available: number;
        earned: number;
        redeemed: number;
        expired: number;
        lifetimeSpend: number;
        tier: string;
      };
      maxRedeemable?: number;
      entries?: { kind: string; points: number }[];
    }>(await loyalty.GET(request("/api/loyalty", { token })));

  const redeem = async (points: number, requestId: string, token = customer.token) =>
    json<{
      ok: boolean;
      error?: string;
      errorAr?: string;
      reason?: string;
      replayed?: boolean;
      points?: number;
      value?: number;
      offerCode?: string;
      offerId?: string;
    }>(
      await loyalty.POST(
        request("/api/loyalty", {
          method: "POST",
          token,
          body: JSON.stringify({ points, requestId }),
        }),
      ),
    );

  /** Credit the account directly, standing in for orders already placed. */
  const credit = async (uid: string, points: number, spend: number, id: string) => {
    await entriesOf(uid).doc(id).set({
      uid,
      kind: "earn",
      points,
      spend,
      at: Date.now() - 1000,
      expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
      orderId: id,
    });
  };

  before(async () => {
    await credit(customer.uid, 1000, 800, "seed-1");
  });

  test("an account sees its balance, its tier and its history", async () => {
    const result = await readBalance(customer.token);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.balance!.available, 1000);
    assert.equal(result.balance!.lifetimeSpend, 800);
    // 800 spent puts the account in silver.
    assert.equal(result.balance!.tier, "silver");
    assert.equal(result.entries!.length, 1);
  });

  test("an unsigned request gets nothing", async () => {
    const anonymous = await json<{ ok: boolean }>(await loyalty.GET(request("/api/loyalty")));
    assert.equal(anonymous.httpStatus, 401);
  });

  test("redeeming debits the ledger and creates a coupon, together", async () => {
    const result = await redeem(400, "req-basic-0001");
    assert.equal(result.ok, true, result.error);
    assert.equal(result.points, 400);
    assert.equal(result.value, 20);

    // The coupon exists, bound to this account and usable once.
    const offer = (await db().collection("offers").doc(result.offerId!).get()).data()!;
    assert.equal(offer.type, "fixed");
    assert.equal(offer.value, 20);
    assert.equal(offer.assignedUid, customer.uid);
    assert.equal(offer.usageLimit, 1);
    assert.equal(offer.status, "active");
    assert.equal(offer.source, "loyalty");

    // And the points are gone.
    const after = await readBalance(customer.token);
    assert.equal(after.balance!.available, 600);
    assert.equal(after.balance!.redeemed, 400);
  });

  test("a retried redemption returns the first coupon rather than minting a second", async () => {
    /*
     * A response lost on the way back is indistinguishable, from the browser,
     * from a request that never arrived — so the customer presses the button
     * again. Without the attempt record that is a second coupon from one
     * balance, which is free money.
     */
    const first = await redeem(200, "req-retry-0001");
    assert.equal(first.ok, true, first.error);

    const again = await redeem(200, "req-retry-0001");
    assert.equal(again.ok, true);
    assert.equal(again.replayed, true);
    assert.equal(again.offerCode, first.offerCode);

    // One coupon, one debit.
    const coupons = await db()
      .collection("offers")
      .where("sourceUid", "==", customer.uid)
      .get();
    const fromThisAttempt = coupons.docs.filter(
      (doc) => doc.data().code === first.offerCode,
    );
    assert.equal(fromThisAttempt.length, 1);

    const after = await readBalance(customer.token);
    assert.equal(after.balance!.available, 400);
  });

  test("redeeming more than the balance is refused, and nothing is written", async () => {
    const before = await readBalance(customer.token);
    const refused = await redeem(5000, "req-toomuch-001");

    assert.equal(refused.httpStatus, 409);
    assert.equal(refused.reason, "insufficient");
    assert.equal((refused.errorAr ?? "").length > 0, true);

    const after = await readBalance(customer.token);
    assert.equal(after.balance!.available, before.balance!.available);

    // No orphaned coupon from the refused attempt.
    const coupons = await db()
      .collection("offers")
      .where("sourceUid", "==", customer.uid)
      .get();
    assert.equal(
      coupons.docs.every((doc) => doc.data().value <= 30),
      true,
    );
  });

  test("an amount below the minimum or off the step is refused", async () => {
    assert.equal((await redeem(50, "req-small-00001")).reason, "below-minimum");
    assert.equal((await redeem(250, "req-step-000001")).reason, "not-a-step");
  });

  test("a redemption with no id is refused, so a retry can never double-spend", async () => {
    const result = await json<{ ok: boolean; error?: string }>(
      await loyalty.POST(
        request("/api/loyalty", {
          method: "POST",
          token: customer.token,
          body: JSON.stringify({ points: 200 }),
        }),
      ),
    );
    assert.equal(result.httpStatus, 400);
  });

  test("one account cannot redeem another's points", async () => {
    // The uid comes from the verified token, never from the body.
    const before = await readBalance(customer.token);
    const other = await redeem(200, "req-stranger-01", stranger.token);
    assert.equal(other.httpStatus, 409);
    assert.equal(other.reason, "insufficient");

    const after = await readBalance(customer.token);
    assert.equal(after.balance!.available, before.balance!.available);
  });

  test("points past their date are not spendable", async () => {
    /*
     * Expiry is computed from the entries rather than swept by a job, so a
     * balance is never wrong because a scheduled task did not run.
     */
    await entriesOf(stranger.uid).doc("stale").set({
      uid: stranger.uid,
      kind: "earn",
      points: 900,
      spend: 900,
      at: Date.now() - 400 * 24 * 60 * 60 * 1000,
      expiresAt: Date.now() - 24 * 60 * 60 * 1000,
      orderId: "old",
    });

    const balance = await readBalance(stranger.token);
    assert.equal(balance.balance!.available, 0);
    assert.equal(balance.balance!.expired, 900);

    const refused = await redeem(200, "req-expired-001", stranger.token);
    assert.equal(refused.reason, "insufficient");
  });

  test("the coupon a redemption made actually works at checkout", async () => {
    /*
     * The whole point of the feature, end to end: points became a coupon, and
     * the coupon has to be a real one the checkout accepts. A redemption that
     * produces a code nothing honours is worse than no programme at all.
     */
    const made = await redeem(200, "req-usable-0001");
    assert.equal(made.ok, true, made.error);

    const offer = (await db().collection("offers").doc(made.offerId!).get()).data()!;
    const verdict = offersLib.evaluateOffer(
      { ...offer, id: made.offerId! } as never,
      {
        items: [line] as never,
        subtotal: 100,
        now: Date.now(),
        currency: "JOD",
        userUsage: 0,
        uid: customer.uid,
        categoryPaths: {},
      },
    );
    assert.equal(verdict.ok, true, verdict.message?.en);
    assert.equal(verdict.discount, 10);
  });

  test("that coupon belongs to the account that earned it", async () => {
    // Points are not a bearer instrument: the code is useless to anyone else.
    const made = await redeem(200, "req-bound-00001");
    const offer = (await db().collection("offers").doc(made.offerId!).get()).data()!;

    const verdict = offersLib.evaluateOffer(
      { ...offer, id: made.offerId! } as never,
      {
        items: [line] as never,
        subtotal: 100,
        now: Date.now(),
        currency: "JOD",
        userUsage: 0,
        uid: stranger.uid,
        categoryPaths: {},
      },
    );
    assert.equal(verdict.ok, false);
  });
});
/* -------------------------------------------------------------------------- */
/*  Back-in-stock alerts                                                      */
/* -------------------------------------------------------------------------- */

describe("stock alerts", () => {
  const db = () => adminSdk.getAdminDb();

  const saveProduct = async (id: string, body: Record<string, unknown>) =>
    json<{ ok: boolean; error?: string }>(
      await products.POST(
        request("/api/admin/products", {
          method: "POST",
          token: owner.token,
          body: JSON.stringify({
            id,
            categoryId: "tees",
            price: 35,
            status: "active",
            ...body,
          }),
        }),
      ),
    );

  const subscribe = async (body: Record<string, unknown>, token = customer.token) =>
    json<{ ok: boolean; error?: string; id?: string; kind?: string }>(
      await alerts.POST(
        request("/api/alerts", { method: "POST", token, body: JSON.stringify(body) }),
      ),
    );

  const mine = async (token = customer.token) =>
    json<{ ok: boolean; alerts?: { id: string; productId: string; notifiedAt?: number }[] }>(
      await alerts.GET(request("/api/alerts", { token })),
    );

  const preview = async () =>
    json<{
      ok: boolean;
      waiting?: number;
      wouldSend?: number;
      skipped?: Record<string, number>;
      mailConfigured?: boolean;
    }>(await adminAlerts.GET(request("/api/admin/alerts", { token: owner.token })));

  const sweep = async (token = owner.token) =>
    json<{
      ok: boolean;
      error?: string;
      waiting?: number;
      sent?: number;
      cleared?: number;
      skipped?: Record<string, number>;
      mailConfigured?: boolean;
    }>(await adminAlerts.POST(request("/api/admin/alerts", { method: "POST", token })));

  before(async () => {
    await saveProduct("e2e-alert-tee", {
      slug: "e2e-alert-tee",
      title: { en: "Alert tee", ar: "تي شيرت تنبيه" },
      type: "variable",
      colors: [{ id: "white", name: { en: "White", ar: "أبيض" }, hex: "#FBFAF3" }],
      sizes: [
        { id: "m", label: "M", system: "alpha" },
        { id: "l", label: "L", system: "alpha" },
      ],
      variants: [
        { sku: "ALERT-WHT-M", colorId: "white", sizeId: "m", stock: 0 },
        { sku: "ALERT-WHT-L", colorId: "white", sizeId: "l", stock: 5 },
      ],
    });
  });

  test("a customer can ask to be told about one size", async () => {
    const result = await subscribe({
      productId: "e2e-alert-tee",
      colorId: "white",
      sizeId: "m",
      kind: "back-in-stock",
      locale: "ar",
    });
    assert.equal(result.ok, true, result.error);

    const stored = (await db().collection("stockAlerts").doc(result.id!).get()).data()!;
    assert.equal(stored.uid, customer.uid);
    assert.equal(stored.sizeId, "m");
    // The language they asked in, so the email is written in it months later.
    assert.equal(stored.locale, "ar");
    // The price comes from the catalogue, never from the request.
    assert.equal(stored.priceAtSubscribe, 35);
  });

  test("asking twice keeps one row, not two emails", async () => {
    // The first tap's confirmation is easy to miss, so people tap again.
    const first = await subscribe({
      productId: "e2e-alert-tee",
      colorId: "white",
      sizeId: "m",
      kind: "back-in-stock",
    });
    const again = await subscribe({
      productId: "e2e-alert-tee",
      colorId: "white",
      sizeId: "m",
      kind: "back-in-stock",
    });
    assert.equal(first.id, again.id);

    const listed = await mine();
    assert.equal(listed.alerts!.filter((a) => a.productId === "e2e-alert-tee").length, 1);
  });

  test("the price it compares against is the catalogue's, not the browser's", async () => {
    /*
     * A browser that can name the price it is watching can name one already
     * beaten, and every sweep from then on mails about a drop that never
     * happened.
     */
    const result = await subscribe({
      productId: "e2e-alert-tee",
      kind: "price-drop",
      priceAtSubscribe: 1,
    });
    const stored = (await db().collection("stockAlerts").doc(result.id!).get()).data()!;
    assert.equal(stored.priceAtSubscribe, 35);
  });

  test("nothing is sent while the size is still gone", async () => {
    const plan = await preview();
    assert.equal(plan.ok, true);
    assert.equal(plan.wouldSend, 0);
    assert.equal((plan.skipped ?? {})["not-yet"]! >= 1, true);
  });

  test("a restock makes it due, and the preview writes nothing", async () => {
    await saveProduct("e2e-alert-tee", {
      slug: "e2e-alert-tee",
      title: { en: "Alert tee", ar: "تي شيرت تنبيه" },
      type: "variable",
      colors: [{ id: "white", name: { en: "White", ar: "أبيض" }, hex: "#FBFAF3" }],
      sizes: [
        { id: "m", label: "M", system: "alpha" },
        { id: "l", label: "L", system: "alpha" },
      ],
      variants: [
        { sku: "ALERT-WHT-M", colorId: "white", sizeId: "m", stock: 4 },
        { sku: "ALERT-WHT-L", colorId: "white", sizeId: "l", stock: 5 },
      ],
    });

    const plan = await preview();
    assert.equal(plan.wouldSend! >= 1, true);

    // Still unsent: a preview is for looking at.
    const listed = await mine();
    assert.equal(listed.alerts!.every((a) => !a.notifiedAt), true);
  });

  test("the sweep marks what it sends, and a second run sends nothing", async () => {
    /*
     * The guarantee that matters. A sweep that forgets what it sent mails the
     * same person on every run, which is the failure customers punish.
     */
    const first = await sweep();
    assert.equal(first.ok, true, first.error);
    assert.equal(first.waiting! >= 1, true);

    const listed = await mine();
    const forThisProduct = listed.alerts!.filter((a) => a.productId === "e2e-alert-tee");
    assert.equal(forThisProduct.some((a) => Boolean(a.notifiedAt)), true);

    /*
     * Nothing left *to send* — not nothing left waiting. A price-drop alert
     * on the same product is still queued and correctly not due, and
     * asserting the queue is empty would be asserting that an alert which
     * has not come true yet was thrown away.
     */
    const after = await preview();
    assert.equal(after.wouldSend, 0);

    const second = await sweep();
    assert.equal(second.sent, 0);
  });

  test("a restock of something nobody can buy is not announced", async () => {
    /*
     * A draft, an archived piece, or one stopped by hand is not "back".
     * Mailing about it sends the customer to a page that refuses them.
     */
    await saveProduct("e2e-alert-draft", {
      slug: "e2e-alert-draft",
      title: { en: "Hidden tee", ar: "تي شيرت مخفي" },
      status: "draft",
      type: "simple",
      totalStock: 10,
    });
    await subscribe({ productId: "e2e-alert-draft", kind: "back-in-stock" });

    const plan = await preview();
    assert.equal(plan.wouldSend, 0);
    assert.equal((plan.skipped ?? {})["not-buyable"]! >= 1, true);
  });

  test("an alert can be cancelled, and only by its owner", async () => {
    const made = await subscribe({
      productId: "e2e-alert-tee",
      colorId: "white",
      sizeId: "l",
      kind: "back-in-stock",
    });

    const byStranger = await json<{ ok: boolean }>(
      await alerts.DELETE(
        request("/api/alerts", {
          method: "DELETE",
          token: stranger.token,
          body: JSON.stringify({ id: made.id }),
        }),
      ),
    );
    assert.equal(byStranger.httpStatus, 403);
    assert.equal((await db().collection("stockAlerts").doc(made.id!).get()).exists, true);

    const byOwner = await json<{ ok: boolean }>(
      await alerts.DELETE(
        request("/api/alerts", {
          method: "DELETE",
          token: customer.token,
          body: JSON.stringify({ id: made.id }),
        }),
      ),
    );
    assert.equal(byOwner.ok, true);
    assert.equal((await db().collection("stockAlerts").doc(made.id!).get()).exists, false);
  });

  test("an anonymous visitor cannot subscribe anybody", async () => {
    // An email box alone would let anyone sign a stranger up for this shop's
    // mail, and a shop whose mail arrives unasked is one whose mail stops
    // arriving at all.
    const anonymous = await json<{ ok: boolean }>(
      await alerts.POST(
        request("/api/alerts", {
          method: "POST",
          body: JSON.stringify({ productId: "e2e-alert-tee" }),
        }),
      ),
    );
    assert.equal(anonymous.httpStatus, 401);
  });

  test("a customer cannot run the sweep", async () => {
    const result = await sweep(customer.token);
    assert.equal(result.httpStatus, 403);
  });

  test("with no mail provider the run says so rather than reporting success", async () => {
    /*
     * `sent: 0` with no explanation is how an unconfigured provider hides for
     * a month. The run states it plainly.
     */
    const result = await sweep();
    assert.equal(result.ok, true);
    assert.equal(result.mailConfigured, false);
  });
});
/* -------------------------------------------------------------------------- */
/*  The fitting room: photo to result                                         */
/* -------------------------------------------------------------------------- */

describe("try-on jobs", () => {
  const db = () => adminSdk.getAdminDb();

  const create = async (body: Record<string, unknown>, token = customer.token) =>
    json<{
      ok: boolean;
      error?: string;
      errorAr?: string;
      reason?: string;
      jobId?: string;
      state?: string;
      remainingToday?: number;
    }>(
      await tryOn.POST(
        request("/api/fitting/try-on", { method: "POST", token, body: JSON.stringify(body) }),
      ),
    );

  const runJob = async (jobId: string, token = customer.token) =>
    json<{ ok: boolean; error?: string; job?: { state: string; error?: string; attempts: number } }>(
      await tryOn.POST(
        request("/api/fitting/try-on", {
          method: "POST",
          token,
          body: JSON.stringify({ action: "run", jobId }),
        }),
      ),
    );

  const status = async (token = customer.token) =>
    json<{
      ok: boolean;
      canStart?: boolean;
      reason?: string | null;
      remainingToday?: number;
      providerConfigured?: boolean;
      jobs?: { id: string; state: string }[];
    }>(await tryOn.GET(request("/api/fitting/try-on", { token })));

  const consent = async (granted: boolean, token = customer.token) =>
    json<{ ok: boolean }>(
      await fittingProfile.POST(
        request("/api/fitting/profile", {
          method: "POST",
          token,
          body: JSON.stringify({ tryOnConsent: granted }),
        }),
      ),
    );

  /** A path inside the caller's own fitting folder. */
  const ownPath = (uid: string) => `users/${uid}/fitting/photo-1.jpg`;

  before(async () => {
    await products.POST(
      request("/api/admin/products", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({
          id: "e2e-tryon-coat",
          slug: "e2e-tryon-coat",
          title: { en: "Try-on coat", ar: "معطف القياس" },
          categoryId: "tees",
          type: "simple",
          price: 120,
          status: "active",
          images: [{ url: "https://cdn.test/coat.jpg", alt: "a coat", width: 800, height: 1000 }],
        }),
      }),
    );
  });

  /* ---- permission --------------------------------------------------------- */

  test("an anonymous visitor cannot start one", async () => {
    const anonymous = await json<{ ok: boolean }>(
      await tryOn.POST(
        request("/api/fitting/try-on", {
          method: "POST",
          body: JSON.stringify({ productId: "e2e-tryon-coat", personImagePath: "x" }),
        }),
      ),
    );
    assert.equal(anonymous.httpStatus, 401);
  });

  test("a photo path outside the caller's own folder is refused", async () => {
    /*
     * The single most important check here. The Admin SDK reading that path
     * bypasses the storage rules, so without it a request could have the
     * server fetch another customer's body photograph and run it through a
     * paid model.
     */
    for (const path of [
      ownPath(stranger.uid),
      "users/../../etc/passwd",
      `users/${customer.uid}/fitting/nested/deep.jpg`,
      "products/p1/photo.jpg",
    ]) {
      const refused = await create({ productId: "e2e-tryon-coat", personImagePath: path });
      assert.equal(refused.httpStatus, 403, path);
    }
  });

  /* ---- consent ------------------------------------------------------------ */

  test("without consent nothing starts, whatever the quota says", async () => {
    // No amount of remaining allowance makes it acceptable to send a picture
    // of somebody's body to a model they did not agree to.
    const refused = await create({
      productId: "e2e-tryon-coat",
      personImagePath: ownPath(customer.uid),
    });
    assert.equal(refused.httpStatus, 409);
    assert.equal(refused.reason, "no-consent");
    assert.equal((refused.errorAr ?? "").length > 0, true);

    // And no job was written, so a refusal leaves nothing to explain later.
    const seen = await status();
    assert.equal(seen.jobs!.length, 0);
  });

  test("consent is recorded with the moment it was given", async () => {
    const result = await consent(true);
    assert.equal(result.ok, true);

    const stored = (await db().collection("users").doc(customer.uid).get()).data()!;
    assert.equal(stored.tryOnConsent, true);
    // "Did this customer agree, and when" gets asked months later.
    assert.equal(typeof stored.tryOnConsentAt, "number");
  });

  test("withdrawing is recorded too, not deleted", async () => {
    /*
     * A missing record cannot tell the difference between somebody who said no
     * and somebody who was never asked.
     */
    await consent(false);
    const stored = (await db().collection("users").doc(customer.uid).get()).data()!;
    assert.equal(stored.tryOnConsent, false);
    assert.equal(typeof stored.tryOnConsentAt, "number");

    const refused = await create({
      productId: "e2e-tryon-coat",
      personImagePath: ownPath(customer.uid),
    });
    assert.equal(refused.reason, "no-consent");

    await consent(true);
  });

  /* ---- the provider being off --------------------------------------------- */

  test("with the provider off, the refusal comes before the job", async () => {
    /*
     * Letting somebody upload a photograph of themselves to find out the
     * feature is not switched on is the worst possible order to do it in.
     */
    const refused = await create({
      productId: "e2e-tryon-coat",
      personImagePath: ownPath(customer.uid),
    });
    assert.equal(refused.httpStatus, 409);
    assert.equal(refused.reason, "not-configured");

    const seen = await status();
    assert.equal(seen.providerConfigured, false);
    assert.equal(seen.canStart, false);
    // Nothing was created, so nothing was spent and nothing is pending.
    assert.equal(seen.jobs!.length, 0);
  });

  test("a job forced into the queue runs to `not-configured`, never to a picture", async () => {
    /*
     * The rule that matters most in this whole feature: no placeholder is ever
     * presented as a try-on. The customer would believe it, and it would be a
     * picture of somebody else.
     *
     * The job is written directly here because the route correctly refuses to
     * create one while the provider is off — this is the run path being
     * checked on its own.
     */
    const ref = db().collection("tryOnJobs").doc();
    await ref.set({
      uid: customer.uid,
      productId: "e2e-tryon-coat",
      state: "queued",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      personImagePath: ownPath(customer.uid),
      productImageUrl: "https://cdn.test/coat.jpg",
    });

    const result = await runJob(ref.id);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.job!.state, "not-configured");

    const stored = (await ref.get()).data()!;
    assert.equal(stored.state, "not-configured");
    assert.equal(stored.resultPath, undefined);
  });

  test("an attempt that never reached the provider does not spend the allowance", async () => {
    /*
     * Fifty refused attempts against an unconfigured provider leave the
     * customer's allowance untouched, because the shop spent nothing on any of
     * them. Charging for work nobody did is the small unfairness that makes a
     * feature feel broken.
     */
    const seen = await status();
    assert.equal(seen.remainingToday, 5);
  });

  test("one account cannot run or read another's job", async () => {
    const ref = db().collection("tryOnJobs").doc();
    await ref.set({
      uid: customer.uid,
      productId: "e2e-tryon-coat",
      state: "queued",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 1000,
      personImagePath: ownPath(customer.uid),
      productImageUrl: "https://cdn.test/coat.jpg",
    });

    const ran = await runJob(ref.id, stranger.token);
    assert.equal(ran.httpStatus, 403);

    const read = await json<{ ok: boolean }>(
      await tryOn.GET(request(`/api/fitting/try-on?jobId=${ref.id}`, { token: stranger.token })),
    );
    assert.equal(read.httpStatus, 403);

    // Untouched by the attempt.
    assert.equal((await ref.get()).data()!.state, "queued");
  });

  test("a settled job is returned rather than run again", async () => {
    // A client that retries must not pay a second time for an answer it has.
    const ref = db().collection("tryOnJobs").doc();
    await ref.set({
      uid: customer.uid,
      productId: "e2e-tryon-coat",
      state: "done",
      resultPath: `users/${customer.uid}/fitting/try-on-abc.jpg`,
      attempts: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 1000,
    });

    const again = await runJob(ref.id);
    assert.equal(again.job!.state, "done");
    assert.equal((await ref.get()).data()!.attempts, 1);
  });

  /* ---- deletion ----------------------------------------------------------- */

  test("a customer can delete their own try-on, and only their own", async () => {
    const ref = db().collection("tryOnJobs").doc();
    await ref.set({
      uid: customer.uid,
      productId: "e2e-tryon-coat",
      state: "done",
      attempts: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 1000,
    });

    const byStranger = await json<{ ok: boolean }>(
      await tryOn.DELETE(
        request("/api/fitting/try-on", {
          method: "DELETE",
          token: stranger.token,
          body: JSON.stringify({ jobId: ref.id }),
        }),
      ),
    );
    assert.equal(byStranger.httpStatus, 403);
    assert.equal((await ref.get()).exists, true);

    const byOwner = await json<{ ok: boolean }>(
      await tryOn.DELETE(
        request("/api/fitting/try-on", {
          method: "DELETE",
          token: customer.token,
          body: JSON.stringify({ jobId: ref.id }),
        }),
      ),
    );
    assert.equal(byOwner.ok, true);
    assert.equal((await ref.get()).exists, false);
  });

  test("deleting one that is already gone is a satisfied request", async () => {
    const result = await json<{ ok: boolean }>(
      await tryOn.DELETE(
        request("/api/fitting/try-on", {
          method: "DELETE",
          token: customer.token,
          body: JSON.stringify({ jobId: "never-existed" }),
        }),
      ),
    );
    assert.equal(result.ok, true);
  });
});
