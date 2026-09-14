/**
 * Seed Firestore with the demo catalogue.
 *
 *   npm run seed              # write products, categories, banners, offers
 *   npm run seed -- --wipe    # delete those collections first
 *
 * Uses the Admin SDK, so it bypasses Security Rules and must never be exposed
 * as an endpoint. It reads the same `src/data/demo.ts` the storefront falls
 * back to, which means the seeded catalogue and the offline catalogue can never
 * drift apart.
 *
 * Requires FIREBASE_ADMIN_* in `.env.local`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  demoBanners,
  demoCategories,
  demoOffers,
  demoProducts,
  demoShippingClasses,
  demoShippingMethods,
  demoTestimonials,
} from "../src/data/demo";

/* -------------------------------------------------------------------------- */
/*  Env                                                                       */
/* -------------------------------------------------------------------------- */

/** Minimal .env.local reader — avoids a dependency for one file. */
function loadEnv() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env.local — fall through to the explicit check below.
  }
}

loadEnv();

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "\n  Missing Admin SDK credentials.\n\n" +
      "  Firebase console > Project settings > Service accounts > Generate new private key,\n" +
      "  then add to .env.local:\n\n" +
      "    FIREBASE_ADMIN_PROJECT_ID=the-jo-shop\n" +
      "    FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-...@the-jo-shop.iam.gserviceaccount.com\n" +
      '    FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"\n',
  );
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
}

const db = getFirestore();
// Optional catalogue fields must be omitted rather than sent as undefined.
db.settings({ ignoreUndefinedProperties: true });
const wipe = process.argv.includes("--wipe");

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Firestore caps a batch at 500 operations, so writes are chunked. */
async function writeAll<T extends { id: string }>(
  collection: string,
  rows: T[],
  transform?: (row: T) => Record<string, unknown>,
) {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));

  for (const chunk of chunks) {
    const batch = db.batch();
    for (const row of chunk) {
      const { id, ...rest } = row;
      batch.set(db.collection(collection).doc(id), transform ? transform(row) : rest, {
        merge: true,
      });
    }
    await batch.commit();
  }
  console.log(`  ${collection.padEnd(14)} ${rows.length} documents`);
}

// The explicit return type is required: the function references itself, so TS
// cannot infer it.
async function wipeCollection(database: Firestore, name: string): Promise<number> {
  const snapshot = await database.collection(name).limit(500).get();
  if (snapshot.empty) return 0;

  const batch = database.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  // A collection larger than one page needs another pass.
  return snapshot.size + (snapshot.size === 500 ? await wipeCollection(database, name) : 0);
}

/* -------------------------------------------------------------------------- */
/*  Run                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`\nSeeding "${projectId}"${wipe ? " (wiping first)" : ""}\n`);

  const collections = [
    "products",
    "categories",
    "banners",
    "offers",
    "testimonials",
    "shippingClasses",
    "shippingMethods",
  ];

  if (wipe) {
    for (const name of collections) {
      const removed = await wipeCollection(db, name);
      if (removed) console.log(`  cleared ${name}: ${removed}`);
    }
    console.log("");
  }

  // `id` is stripped and used as the document id — see `writeAll`. Dates stay
  // as epoch millis, matching what `converters.ts` normalises reads to.
  await writeAll("products", demoProducts);
  await writeAll("categories", demoCategories);
  await writeAll("banners", demoBanners);
  await writeAll("offers", demoOffers);
  await writeAll("testimonials", demoTestimonials);
  // Rate configuration, seeded like the catalogue so a fresh project has
  // working shipping rather than a checkout that quotes zero for everything.
  await writeAll("shippingClasses", demoShippingClasses);
  await writeAll("shippingMethods", demoShippingMethods);

  console.log(
    "\nDone. Set NEXT_PUBLIC_DISABLE_DEMO_FALLBACK=true in .env.local once you are\n" +
      "happy with the data, so a failed read surfaces instead of silently falling\n" +
      "back to the bundled catalogue.\n",
  );
}

main().catch((error) => {
  console.error("\nSeed failed:", error);
  process.exit(1);
});
