/**
 * Move legacy `visibilitySchedule.showAt` fields into the map they belong in.
 *
 *     npm run migrate:schedule           # dry run — reports, writes nothing
 *     npm run migrate:schedule -- --apply
 *
 * ## What went wrong
 *
 * The warehouse route built `{"visibilitySchedule.showAt": 1760000000000}` and
 * wrote it with `set(..., { merge: true })`. A dotted key is a *field path*
 * only to `update()`. To `set()` it is a field **name**, so Firestore created
 * a top-level field literally called `visibilitySchedule.showAt` — sitting
 * beside `visibilitySchedule` rather than inside it. The reader looks at
 * `product.visibilitySchedule?.showAt` and has never seen one.
 *
 * The write path is fixed. That does nothing for documents already written, so
 * this moves them.
 *
 * ## Why a faithful migration would be wrong
 *
 * The first dry run over the live catalogue found all fifteen products
 * carrying `hideAt` set to a moment that has already passed — one bulk action,
 * in the audit log, that was never visibly applied because the field was
 * inert. Moving that value into the map verbatim would make
 * `effectiveVisibility` return `hidden` on the next request for every one of
 * them: the whole shop would go dark, as the delayed result of a click nobody
 * saw take effect.
 *
 * So a **spent** schedule is dropped rather than moved. A bound that has
 * already elapsed and has never once had an effect is not a pending
 * instruction; treating it as one lets a stale click reach through weeks of
 * inertness and change what is on sale. A bound still in the future *is* a
 * real intention and is moved into the map.
 *
 * `--force-past` moves them anyway, for the case where a merchant genuinely
 * wants an elapsed schedule honoured. It is not the default because the
 * default should not be able to empty a shop.
 *
 * ## Conflicts
 *
 * A document can hold both forms: the legacy flat field, and a real nested
 * value written since the fix. **The nested value wins**, because it is the
 * only one that has ever had any effect. The flat field is removed either way,
 * and every conflict is listed by id so a person can look.
 *
 * Nothing else about the product is touched: no stock, no status, no price.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";

/* --- env ----------------------------------------------------------------- */

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
    /* fall through to the explicit check below */
  }
}

loadEnv();

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "\n  Missing Admin SDK credentials. Set FIREBASE_ADMIN_PROJECT_ID,\n" +
      "  FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY in .env.local.\n",
  );
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
}

/* --- the migration ------------------------------------------------------- */

const APPLY = process.argv.includes("--apply");
/** Move bounds that have already elapsed. Off by default — see the note above. */
const FORCE_PAST = process.argv.includes("--force-past");
const NOW = Date.now();

const FLAT_SHOW = "visibilitySchedule.showAt";
const FLAT_HIDE = "visibilitySchedule.hideAt";

interface Finding {
  id: string;
  title: string;
  movedShowAt?: number;
  movedHideAt?: number;
  /** Bounds dropped because they had already elapsed without ever applying. */
  spent: string[];
  conflicts: string[];
}

function millisOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const record = value as { toMillis?: () => number; _seconds?: number };
    if (typeof record.toMillis === "function") return record.toMillis();
    if (typeof record._seconds === "number") return record._seconds * 1000;
  }
  return undefined;
}

async function main() {
  const db = getFirestore();
  const snap = await db.collection("products").get();

  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} — scanning ${snap.size} product document(s)\n`,
  );

  const findings: Finding[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();

    const flatShow = millisOf(data[FLAT_SHOW]);
    const flatHide = millisOf(data[FLAT_HIDE]);
    if (flatShow === undefined && flatHide === undefined) continue;

    const nested = (data.visibilitySchedule ?? {}) as { showAt?: unknown; hideAt?: unknown };
    const nestedShow = millisOf(nested.showAt);
    const nestedHide = millisOf(nested.hideAt);

    const finding: Finding = {
      id: doc.id,
      title: String(data.title?.en ?? data.title?.ar ?? doc.id),
      spent: [],
      conflicts: [],
    };

    const schedule: Record<string, number> = {};

    /**
     * Decide what happens to one legacy bound.
     *
     * Three outcomes: the nested value already disagrees (keep it), the bound
     * has elapsed (drop it), or it is a genuine pending instruction (move it).
     */
    const consider = (
      name: "showAt" | "hideAt",
      flat: number | undefined,
      nested: number | undefined,
    ) => {
      if (flat === undefined) return;

      if (nested !== undefined && nested !== flat) {
        finding.conflicts.push(
          `${name}: keeping nested ${new Date(nested).toISOString()}, ` +
            `discarding inert ${new Date(flat).toISOString()}`,
        );
        return;
      }
      if (nested !== undefined) return; // identical; nothing to do

      if (flat <= NOW && !FORCE_PAST) {
        finding.spent.push(`${name} ${new Date(flat).toISOString()}`);
        return;
      }

      schedule[name] = flat;
      if (name === "showAt") finding.movedShowAt = flat;
      else finding.movedHideAt = flat;
    };

    consider("showAt", flatShow, nestedShow);
    consider("hideAt", flatHide, nestedHide);

    findings.push(finding);

    if (!APPLY) continue;

    /*
     * One `update` per document rather than a batch.
     *
     * Removing a field whose *name* contains a dot needs `FieldPath` with a
     * single literal segment — the string form would be read as a path and
     * would try to delete `showAt` inside the map, which is the opposite of
     * the intent. Mixing that with a merged `set` in one batch is not worth
     * the cleverness for a one-off run over a small collection.
     */
    if (Object.keys(schedule).length > 0) {
      await doc.ref.set({ visibilitySchedule: schedule }, { merge: true });
    }
    await doc.ref.update(new FieldPath(FLAT_SHOW), FieldValue.delete()).catch(() => {});
    await doc.ref.update(new FieldPath(FLAT_HIDE), FieldValue.delete()).catch(() => {});
  }

  if (findings.length === 0) {
    console.log("No legacy dotted schedule fields found. Nothing to migrate.");
    return;
  }

  for (const f of findings) {
    const moves = [
      f.movedShowAt !== undefined ? `showAt → ${new Date(f.movedShowAt).toISOString()}` : null,
      f.movedHideAt !== undefined ? `hideAt → ${new Date(f.movedHideAt).toISOString()}` : null,
    ].filter(Boolean);

    console.log(`  ${f.id}  ${f.title}`);
    if (moves.length) console.log(`      moved:    ${moves.join(", ")}`);
    for (const s of f.spent) console.log(`      spent:    ${s} — elapsed, dropped`);
    for (const c of f.conflicts) console.log(`      conflict: ${c}`);
    if (!moves.length && !f.spent.length && !f.conflicts.length) {
      console.log("      removed inert field only");
    }
  }

  const conflicted = findings.filter((f) => f.conflicts.length > 0).length;
  const spent = findings.filter((f) => f.spent.length > 0).length;

  console.log(
    `\n${findings.length} document(s) affected · ${spent} with a spent bound ` +
      `· ${conflicted} with a conflict.`,
  );
  if (spent > 0 && !FORCE_PAST) {
    console.log(
      "\n  Spent bounds were dropped, not moved. They had already elapsed and had\n" +
        "  never taken effect, so applying them now would change what is on sale\n" +
        "  as the delayed result of a click nobody saw work. Use --force-past to\n" +
        "  move them anyway.",
    );
  }
  console.log(APPLY ? "\nApplied." : "\nNothing written — re-run with --apply.");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
